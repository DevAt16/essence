import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import pg from 'pg'

const { Pool } = pg

const schemaPath = new URL('./schema.sql', import.meta.url)
const stateRowId = 'default'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the PostgreSQL API.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

export async function ensureSchema() {
  const schema = await readFile(schemaPath, 'utf8')
  await pool.query(schema)
  await migrateLegacySnapshotIfNeeded()
}

export async function getAppState() {
  const client = await pool.connect()

  try {
    return await readNormalizedState(client)
  } finally {
    client.release()
  }
}

export async function saveAppState(state, options = {}) {
  const client = await pool.connect()

  try {
    await client.query('begin')
    await replaceNormalizedState(client, state, {
      recordRevisions: true,
      revisionEvents: Array.isArray(options.revisionEvents) ? options.revisionEvents : [],
      updateLegacySnapshot: true,
    })
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function getNoteRevisions(noteId, limit = 20) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 50) : 20
  const result = await pool.query(
    `
      select
        id,
        note_id as "noteId",
        note_title as "noteTitle",
        revision_kind as "revisionKind",
        created_at as "createdAt",
        snapshot
      from note_revisions
      where note_id = $1
      order by created_at desc, id desc
      limit $2
    `,
    [noteId, safeLimit],
  )

  return result.rows
}

export async function searchNotes(query, limit = 24) {
  const trimmedQuery = String(query ?? '').trim().toLowerCase()

  if (!trimmedQuery) {
    return []
  }

  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 60) : 24
  const likePattern = `%${trimmedQuery}%`
  const result = await pool.query(
    `
      with recursive folder_paths as (
        select
          id,
          parent_id,
          lower(name) as path_text
        from folders
        where parent_id is null

        union all

        select
          child.id,
          child.parent_id,
          folder_paths.path_text || ' / ' || lower(child.name) as path_text
        from folders child
        join folder_paths on folder_paths.id = child.parent_id
      ),
      block_search as (
        select
          note_id,
          lower(
            string_agg(
              trim(
                concat_ws(
                  ' ',
                  coalesce(text_content, ''),
                  coalesce(citation, ''),
                  coalesce(
                    (
                      select string_agg(item_text, ' ')
                      from jsonb_array_elements_text(coalesce(items, '[]'::jsonb)) as item(item_text)
                    ),
                    ''
                  )
                )
              ),
              ' '
              order by position
            )
          ) as block_text
        from note_blocks
        group by note_id
      ),
      tag_search as (
        select
          note_id,
          lower(string_agg(tag, ' ' order by position)) as tag_text
        from note_tags
        group by note_id
      ),
      link_search as (
        select
          note_links.source_note_id as note_id,
          lower(string_agg(target_notes.title, ' ' order by target_notes.title)) as link_text
        from note_links
        join notes as target_notes on target_notes.id = note_links.target_note_id
        group by note_links.source_note_id
      ),
      prepared as (
        select
          notes.id as "noteId",
          notes.updated_at as "updatedAt",
          lower(notes.title) as title_text,
          coalesce(block_search.block_text, '') as block_text,
          coalesce(tag_search.tag_text, '') as tag_text,
          coalesce(folder_paths.path_text, '') as folder_text,
          coalesce(link_search.link_text, '') as link_text,
          notes.is_favorite as "isFavorite",
          notes.is_pinned as "isPinned"
        from notes
        left join block_search on block_search.note_id = notes.id
        left join tag_search on tag_search.note_id = notes.id
        left join folder_paths on folder_paths.id = notes.folder_id
        left join link_search on link_search.note_id = notes.id
      ),
      scored as (
        select
          "noteId",
          "updatedAt",
          (
            case when title_text = $1 then 1000 else 0 end +
            case when title_text like $2 then 600 else 0 end +
            case when tag_text like $2 then 320 else 0 end +
            case when folder_text like $2 then 220 else 0 end +
            case when link_text like $2 then 180 else 0 end +
            case when block_text like $2 then 120 else 0 end +
            case when "isPinned" then 24 else 0 end +
            case when "isFavorite" then 8 else 0 end
          ) as score,
          array_remove(
            array[
              case when title_text = $1 then 'exact-title' end,
              case when title_text like $2 then 'title' end,
              case when tag_text like $2 then 'tag' end,
              case when folder_text like $2 then 'folder' end,
              case when link_text like $2 then 'link' end,
              case when block_text like $2 then 'body' end
            ],
            null
          ) as "matchedFields"
        from prepared
        where
          title_text like $2 or
          block_text like $2 or
          tag_text like $2 or
          folder_text like $2 or
          link_text like $2
      )
      select
        "noteId",
        score,
        "matchedFields"
      from scored
      order by score desc, "updatedAt" desc, "noteId" asc
      limit $3
    `,
    [trimmedQuery, likePattern, safeLimit],
  )

  return result.rows
}

async function migrateLegacySnapshotIfNeeded() {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const countsResult = await client.query(`
      select
        (select count(*)::int from workspace_state) as "workspaceCount",
        (select count(*)::int from folders) as "foldersCount",
        (select count(*)::int from notes) as "notesCount"
    `)
    const counts = countsResult.rows[0]

    if ((counts?.workspaceCount ?? 0) > 0 || (counts?.foldersCount ?? 0) > 0 || (counts?.notesCount ?? 0) > 0) {
      await client.query('commit')
      return
    }

    const legacyResult = await client.query('select payload from app_state where id = $1 limit 1', [stateRowId])
    const legacyState = legacyResult.rows[0]?.payload ?? null

    if (isPersistedAppState(legacyState)) {
      await replaceNormalizedState(client, legacyState, { recordRevisions: false, updateLegacySnapshot: false })
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function readNormalizedState(client) {
  const [workspaceResult, folderResult, noteResult, blockResult, tagResult] = await Promise.all([
    client.query(
      `
        select active_note_id as "activeNoteId"
        from workspace_state
        where id = $1
        limit 1
      `,
      [stateRowId],
    ),
    client.query(
      `
        select
          id,
          name,
          parent_id as "parentId",
          collection_id as "collectionId"
        from folders
        order by sort_order asc, id asc
      `,
    ),
    client.query(
      `
        select
          id,
          title,
          collection_id as "collectionId",
          folder_id as "folderId",
          status,
          preview_date as "previewDate",
          is_favorite as "isFavorite",
          is_pinned as "isPinned",
          is_archived as "isArchived",
          type,
          layout,
          updated_at as "updatedAt"
        from notes
        order by sort_order asc, id asc
      `,
    ),
    client.query(
      `
        select
          id,
          note_id as "noteId",
          type,
          text_content as "text",
          items,
          citation
        from note_blocks
        order by note_id asc, position asc
      `,
    ),
    client.query(
      `
        select
          note_id as "noteId",
          tag
        from note_tags
        order by note_id asc, position asc
      `,
    ),
  ])

  if (workspaceResult.rowCount === 0 && folderResult.rowCount === 0 && noteResult.rowCount === 0) {
    return null
  }

  const blocksByNoteId = new Map()

  for (const row of blockResult.rows) {
    const blocks = blocksByNoteId.get(row.noteId) ?? []
    blocks.push({
      id: row.id,
      type: row.type,
      text: row.text ?? '',
      items: Array.isArray(row.items) ? row.items : row.type === 'bullet-list' ? [''] : undefined,
      citation: row.citation ?? '',
    })
    blocksByNoteId.set(row.noteId, blocks)
  }

  const tagsByNoteId = new Map()

  for (const row of tagResult.rows) {
    const tags = tagsByNoteId.get(row.noteId) ?? []
    tags.push(row.tag)
    tagsByNoteId.set(row.noteId, tags)
  }

  const notes = noteResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    collectionId: row.collectionId,
    folderId: row.folderId,
    status: row.status,
    blocks: blocksByNoteId.get(row.id) ?? [],
    tags: tagsByNoteId.get(row.id) ?? [],
    previewDate: row.previewDate,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? new Date().toISOString()),
    isFavorite: Boolean(row.isFavorite),
    isPinned: Boolean(row.isPinned),
    isArchived: Boolean(row.isArchived),
    type: row.type === 'quote' ? 'quote' : undefined,
    layout: row.layout,
  }))

  return {
    activeNoteId: workspaceResult.rows[0]?.activeNoteId ?? notes[0]?.id ?? null,
    folders: folderResult.rows,
    notes,
  }
}

async function replaceNormalizedState(client, rawState, options) {
  const { recordRevisions = true, revisionEvents = [], updateLegacySnapshot = true } = options ?? {}
  const state = normalizePersistedAppState(rawState)

  if (recordRevisions) {
    await captureNoteRevisions(client, state.notes, revisionEvents)
  }

  await client.query('delete from note_links')
  await client.query('delete from note_tags')
  await client.query('delete from note_blocks')
  await client.query('delete from notes')
  await client.query('delete from folders')

  const validFolderIds = new Set(state.folders.map((folder) => folder.id))
  const sortedFolders = sortFoldersForPersistence(state.folders)

  for (const [index, folder] of sortedFolders.entries()) {
    await client.query(
      `
        insert into folders (id, name, parent_id, collection_id, sort_order, updated_at)
        values ($1, $2, $3, $4, $5, now())
      `,
      [
        folder.id,
        folder.name,
        folder.parentId && validFolderIds.has(folder.parentId) ? folder.parentId : null,
        folder.collectionId,
        index,
      ],
    )
  }

  for (const [noteIndex, note] of state.notes.entries()) {
    await client.query(
      `
        insert into notes (
          id,
          title,
          collection_id,
          folder_id,
          status,
          preview_date,
          is_favorite,
          is_pinned,
          is_archived,
          type,
          layout,
          sort_order,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        note.id,
        note.title,
        note.collectionId,
        note.folderId && validFolderIds.has(note.folderId) ? note.folderId : null,
        note.status,
        note.previewDate,
        note.isFavorite,
        Boolean(note.isPinned),
        Boolean(note.isArchived),
        note.type ?? null,
        note.layout,
        noteIndex,
        note.updatedAt ?? new Date().toISOString(),
      ],
    )

    for (const [blockIndex, block] of note.blocks.entries()) {
      await client.query(
        `
          insert into note_blocks (id, note_id, position, type, text_content, items, citation)
          values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          block.id,
          note.id,
          blockIndex,
          block.type,
          block.text ?? '',
          Array.isArray(block.items) ? JSON.stringify(block.items) : null,
          block.citation ?? '',
        ],
      )
    }

    for (const [tagIndex, tag] of note.tags.entries()) {
      await client.query(
        `
          insert into note_tags (note_id, tag, position)
          values ($1, $2, $3)
        `,
        [note.id, tag, tagIndex],
      )
    }
  }

  for (const linkRow of buildNoteLinkRows(state.notes)) {
    await client.query(
      `
        insert into note_links (
          source_note_id,
          target_note_id,
          source_block_id,
          link_text,
          occurrence_count
        )
        values ($1, $2, $3, $4, $5)
      `,
      [
        linkRow.sourceNoteId,
        linkRow.targetNoteId,
        linkRow.sourceBlockId,
        linkRow.linkText,
        linkRow.occurrenceCount,
      ],
    )
  }

  await client.query(
    `
      insert into workspace_state (id, active_note_id, updated_at)
      values ($1, $2, now())
      on conflict (id)
      do update set active_note_id = excluded.active_note_id, updated_at = now()
    `,
    [stateRowId, state.activeNoteId],
  )

  if (updateLegacySnapshot) {
    await upsertLegacySnapshot(client, state)
  }
}

async function captureNoteRevisions(client, nextNotes, revisionEvents = []) {
  const persistedNotesById = await readPersistedNotesById(client)
  const revisionKindsByNoteId = new Map(
    revisionEvents
      .filter((event) => typeof event?.noteId === 'string' && typeof event?.revisionKind === 'string')
      .map((event) => [event.noteId, event.revisionKind]),
  )
  const nextNotesById = new Map(
    nextNotes.map((note) => {
      const snapshot = createRevisionSnapshot(note)
      return [
        note.id,
        {
          snapshot,
          snapshotHash: createSnapshotHash(snapshot),
        },
      ]
    }),
  )

  for (const note of nextNotes) {
    const nextEntry = nextNotesById.get(note.id)
    const persistedEntry = persistedNotesById.get(note.id)

    if (!nextEntry) {
      continue
    }

    if (!persistedEntry || persistedEntry.snapshotHash !== nextEntry.snapshotHash) {
      await insertNoteRevision(
        client,
        note.id,
        note.title,
        revisionKindsByNoteId.get(note.id) ?? (persistedEntry ? 'snapshot' : 'created'),
        nextEntry.snapshot,
        nextEntry.snapshotHash,
      )
    }
  }

  for (const [noteId, persistedEntry] of persistedNotesById.entries()) {
    if (nextNotesById.has(noteId)) {
      continue
    }

    await insertNoteRevision(
      client,
      noteId,
      persistedEntry.snapshot.title ?? 'Untitled Note',
      'deleted',
      persistedEntry.snapshot,
      persistedEntry.snapshotHash,
    )
  }
}

async function readPersistedNotesById(client) {
  const state = await readNormalizedState(client)
  const notesById = new Map()

  for (const note of state?.notes ?? []) {
    const snapshot = createRevisionSnapshot(note)
    notesById.set(note.id, {
      snapshot,
      snapshotHash: createSnapshotHash(snapshot),
    })
  }

  return notesById
}

async function insertNoteRevision(client, noteId, noteTitle, revisionKind, snapshot, snapshotHash) {
  await client.query(
    `
      insert into note_revisions (
        note_id,
        note_title,
        snapshot,
        snapshot_hash,
        revision_kind
      )
      values ($1, $2, $3::jsonb, $4, $5)
    `,
    [noteId, noteTitle, JSON.stringify(snapshot), snapshotHash, revisionKind],
  )
}

async function upsertLegacySnapshot(client, state) {
  await client.query(
    `
      insert into app_state (id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set payload = excluded.payload, updated_at = now()
    `,
    [stateRowId, JSON.stringify(state)],
  )
}

function normalizePersistedAppState(value) {
  return {
    activeNoteId: typeof value?.activeNoteId === 'string' || value?.activeNoteId === null ? value.activeNoteId : null,
    folders: Array.isArray(value?.folders) ? value.folders : [],
    notes: Array.isArray(value?.notes) ? value.notes : [],
  }
}

function isPersistedAppState(value) {
  if (!value || typeof value !== 'object') {
    return false
  }

  return (
    (typeof value.activeNoteId === 'string' || value.activeNoteId === null) &&
    Array.isArray(value.folders) &&
    Array.isArray(value.notes)
  )
}

function sortFoldersForPersistence(folders) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const originalOrder = new Map(folders.map((folder, index) => [folder.id, index]))
  const depthCache = new Map()

  const getDepth = (folder) => {
    if (depthCache.has(folder.id)) {
      return depthCache.get(folder.id)
    }

    let depth = 0
    let parentId = folder.parentId
    const seen = new Set([folder.id])

    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId)
      depth += 1
      parentId = byId.get(parentId).parentId
    }

    depthCache.set(folder.id, depth)
    return depth
  }

  return [...folders].sort((left, right) => {
    const depthDifference = getDepth(left) - getDepth(right)

    if (depthDifference !== 0) {
      return depthDifference
    }

    return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
  })
}

function buildNoteLinkRows(notes) {
  const titleToNoteId = new Map(
    notes
      .filter((note) => typeof note.title === 'string' && note.title.trim().length > 0)
      .map((note) => [normalizeLinkTitle(note.title), note.id]),
  )

  return notes.flatMap((note) => {
    const dedupedRows = new Map()

    for (const block of note.blocks ?? []) {
      for (const text of getTextsForLinkExtraction(block)) {
        for (const linkText of extractNoteLinkTitles(text)) {
          const targetNoteId = titleToNoteId.get(normalizeLinkTitle(linkText))

          if (!targetNoteId || targetNoteId === note.id) {
            continue
          }

          const key = `${note.id}::${targetNoteId}::${block.id}::${linkText}`
          const existingRow = dedupedRows.get(key)

          dedupedRows.set(key, {
            sourceNoteId: note.id,
            targetNoteId,
            sourceBlockId: block.id,
            linkText,
            occurrenceCount: (existingRow?.occurrenceCount ?? 0) + 1,
          })
        }
      }
    }

    return Array.from(dedupedRows.values())
  })
}

function getTextsForLinkExtraction(block) {
  if (block.type === 'code') {
    return []
  }

  if (block.type === 'bullet-list') {
    return Array.isArray(block.items) ? block.items : []
  }

  return [block.text ?? '', block.citation ?? '']
}

function extractNoteLinkTitles(text) {
  return Array.from(String(text ?? '').matchAll(/\[\[([^[\]]+)\]\]/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function normalizeLinkTitle(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function createRevisionSnapshot(note) {
  return {
    id: note.id,
    title: note.title,
    collectionId: note.collectionId,
    folderId: note.folderId,
    status: note.status,
    blocks: (note.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.type,
      text: block.text ?? '',
      items: Array.isArray(block.items) ? [...block.items] : undefined,
      citation: block.citation ?? '',
    })),
    tags: Array.isArray(note.tags) ? [...note.tags] : [],
    previewDate: note.previewDate,
    updatedAt: note.updatedAt,
    isFavorite: Boolean(note.isFavorite),
    isPinned: Boolean(note.isPinned),
    isArchived: Boolean(note.isArchived),
    type: note.type === 'quote' ? 'quote' : undefined,
    layout: note.layout,
  }
}

function createSnapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}
