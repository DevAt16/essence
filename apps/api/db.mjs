import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import pg from 'pg'

const { Pool } = pg

const schemaPath = new URL('./schema.sql', import.meta.url)
const legacyStateRowId = 'default'
export const localUserId = 'local'

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

export async function getAppState(userId = localUserId) {
  const client = await pool.connect()

  try {
    return await readNormalizedState(client, userId)
  } finally {
    client.release()
  }
}

export async function saveAppState(state, options = {}) {
  const client = await pool.connect()
  const userId = typeof options.userId === 'string' && options.userId ? options.userId : localUserId

  try {
    await client.query('begin')
    await replaceNormalizedState(client, state, {
      userId,
      recordRevisions: options.recordRevisions ?? true,
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

export async function getLocalUser() {
  return getUserById(localUserId)
}

export async function getUserById(userId) {
  const result = await pool.query(
    `
      select
        id,
        email,
        display_name as "displayName",
        is_local as "isLocal",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from users
      where id = $1
      limit 1
    `,
    [userId],
  )

  return result.rows[0] ?? null
}

export async function approveUserEmail(email, options = {}) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return null
  }

  const result = await pool.query(
    `
      insert into approved_users (email, display_name, notes, approved_by, approved_at, revoked_at, updated_at)
      values ($1, $2, $3, $4, now(), null, now())
      on conflict (email)
      do update set
        display_name = excluded.display_name,
        notes = excluded.notes,
        approved_by = excluded.approved_by,
        approved_at = now(),
        revoked_at = null,
        updated_at = now()
      returning
        email,
        display_name as "displayName",
        notes,
        approved_by as "approvedBy",
        approved_at as "approvedAt",
        revoked_at as "revokedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      normalizedEmail,
      normalizeOptionalString(options.displayName, 120),
      normalizeOptionalString(options.notes, 500) ?? '',
      normalizeOptionalString(options.approvedBy, 120),
    ],
  )

  return result.rows[0] ?? null
}

export async function revokeApprovedUserEmail(email) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return null
  }

  const result = await pool.query(
    `
      update approved_users
      set revoked_at = now(), updated_at = now()
      where email = $1
      returning
        email,
        display_name as "displayName",
        notes,
        approved_by as "approvedBy",
        approved_at as "approvedAt",
        revoked_at as "revokedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [normalizedEmail],
  )

  return result.rows[0] ?? null
}

export async function listApprovedUsers() {
  const result = await pool.query(
    `
      select
        email,
        display_name as "displayName",
        notes,
        approved_by as "approvedBy",
        approved_at as "approvedAt",
        revoked_at as "revokedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from approved_users
      order by revoked_at nulls first, approved_at desc, email asc
    `,
  )

  return result.rows
}

export async function isApprovedUserEmail(email) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return false
  }

  const result = await pool.query(
    `
      select 1
      from approved_users
      where email = $1 and revoked_at is null
      limit 1
    `,
    [normalizedEmail],
  )

  return Boolean(result.rows[0])
}

export async function getOrCreateUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return null
  }

  const displayName = createDisplayName(normalizedEmail)
  const userId = `user_${randomBytes(12).toString('hex')}`
  const result = await pool.query(
    `
      insert into users (id, email, display_name, is_local, updated_at)
      values ($1, $2, $3, false, now())
      on conflict (email)
      do update set updated_at = now()
      returning
        id,
        email,
        display_name as "displayName",
        is_local as "isLocal",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [userId, normalizedEmail, displayName],
  )

  return result.rows[0] ?? null
}

export async function getOrCreateExternalUser({ displayName, email, provider, subject }) {
  const normalizedProvider = normalizeIdentityValue(provider)
  const normalizedSubject = normalizeIdentityValue(subject)
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedProvider || !normalizedSubject || !normalizedEmail) {
    return null
  }

  const client = await pool.connect()

  try {
    await client.query('begin')

    const existingIdentity = await client.query(
      `
        select
          users.id,
          users.email,
          users.display_name as "displayName",
          users.is_local as "isLocal",
          users.created_at as "createdAt",
          users.updated_at as "updatedAt"
        from user_identities
        join users on users.id = user_identities.user_id
        where user_identities.provider = $1 and user_identities.subject = $2
        limit 1
      `,
      [normalizedProvider, normalizedSubject],
    )

    if (existingIdentity.rows[0]) {
      await client.query(
        `
          update user_identities
          set email = $3, updated_at = now()
          where provider = $1 and subject = $2
        `,
        [normalizedProvider, normalizedSubject, normalizedEmail],
      )
      await client.query('commit')
      return existingIdentity.rows[0]
    }

    const existingUser = await client.query(
      `
        select
          id,
          email,
          display_name as "displayName",
          is_local as "isLocal",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from users
        where email = $1
        limit 1
      `,
      [normalizedEmail],
    )

    let user = existingUser.rows[0] ?? null

    if (!user) {
      const userId = `user_${randomBytes(12).toString('hex')}`
      const createdUser = await client.query(
        `
          insert into users (id, email, display_name, is_local, updated_at)
          values ($1, $2, $3, false, now())
          returning
            id,
            email,
            display_name as "displayName",
            is_local as "isLocal",
            created_at as "createdAt",
            updated_at as "updatedAt"
        `,
        [userId, normalizedEmail, normalizeDisplayName(displayName, normalizedEmail)],
      )
      user = createdUser.rows[0] ?? null
    }

    if (!user) {
      await client.query('rollback')
      return null
    }

    await client.query(
      `
        insert into user_identities (provider, subject, user_id, email, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (provider, subject)
        do update set user_id = excluded.user_id, email = excluded.email, updated_at = now()
      `,
      [normalizedProvider, normalizedSubject, user.id, normalizedEmail],
    )

    await client.query('commit')
    return user
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function createUserSession(userId) {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createSessionTokenHash(token)
  const expiresAt = new Date(Date.now() + getSessionDurationMs())

  await pool.query(
    `
      insert into user_sessions (token_hash, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [tokenHash, userId, expiresAt.toISOString()],
  )

  return { expiresAt, token }
}

export async function getUserBySessionToken(token) {
  if (!token) {
    return null
  }

  await pool.query('delete from user_sessions where expires_at <= now()')

  const result = await pool.query(
    `
      select
        users.id,
        users.email,
        users.display_name as "displayName",
        users.is_local as "isLocal",
        users.created_at as "createdAt",
        users.updated_at as "updatedAt"
      from user_sessions
      join users on users.id = user_sessions.user_id
      where user_sessions.token_hash = $1 and user_sessions.expires_at > now()
      limit 1
    `,
    [createSessionTokenHash(token)],
  )

  return result.rows[0] ?? null
}

export async function deleteUserSession(token) {
  if (!token) {
    return
  }

  await pool.query('delete from user_sessions where token_hash = $1', [createSessionTokenHash(token)])
}

export async function getNoteRevisions(noteId, limit = 20, userId = localUserId) {
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
      where note_id = $1 and user_id = $3
      order by created_at desc, id desc
      limit $2
    `,
    [noteId, safeLimit, userId],
  )

  return result.rows
}

export async function searchNotes(query, limit = 24, userId = localUserId) {
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
        where parent_id is null and user_id = $3

        union all

        select
          child.id,
          child.parent_id,
          folder_paths.path_text || ' / ' || lower(child.name) as path_text
        from folders child
        join folder_paths on folder_paths.id = child.parent_id
        where child.user_id = $3
      ),
      block_search as (
        select
          note_blocks.note_id,
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
        join notes on notes.id = note_blocks.note_id
        where notes.user_id = $3
        group by note_blocks.note_id
      ),
      tag_search as (
        select
          note_tags.note_id,
          lower(string_agg(tag, ' ' order by position)) as tag_text
        from note_tags
        join notes on notes.id = note_tags.note_id
        where notes.user_id = $3
        group by note_tags.note_id
      ),
      source_search as (
        select
          note_sources.note_id,
          lower(
            string_agg(
              concat_ws(
                ' ',
                source_type,
                title,
                author,
                year,
                publisher,
                url,
                note
              ),
              ' '
              order by position
            )
          ) as source_text
        from note_sources
        join notes on notes.id = note_sources.note_id
        where notes.user_id = $3
        group by note_sources.note_id
      ),
      link_search as (
        select
          note_links.source_note_id as note_id,
          lower(string_agg(target_notes.title, ' ' order by target_notes.title)) as link_text
        from note_links
        join notes as source_notes on source_notes.id = note_links.source_note_id
        join notes as target_notes on target_notes.id = note_links.target_note_id
        where source_notes.user_id = $3 and target_notes.user_id = $3
        group by note_links.source_note_id
      ),
      prepared as (
        select
          notes.id as "noteId",
          notes.updated_at as "updatedAt",
          lower(notes.title) as title_text,
          coalesce(block_search.block_text, '') as block_text,
          coalesce(source_search.source_text, '') as source_text,
          coalesce(tag_search.tag_text, '') as tag_text,
          coalesce(folder_paths.path_text, '') as folder_text,
          coalesce(link_search.link_text, '') as link_text,
          notes.is_favorite as "isFavorite",
          notes.is_pinned as "isPinned"
        from notes
        left join block_search on block_search.note_id = notes.id
        left join source_search on source_search.note_id = notes.id
        left join tag_search on tag_search.note_id = notes.id
        left join folder_paths on folder_paths.id = notes.folder_id
        left join link_search on link_search.note_id = notes.id
        where notes.user_id = $3
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
            case when source_text like $2 then 160 else 0 end +
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
              case when source_text like $2 then 'source' end,
              case when block_text like $2 then 'body' end
            ],
            null
          ) as "matchedFields"
        from prepared
        where
          title_text like $2 or
          block_text like $2 or
          source_text like $2 or
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
      limit $4
    `,
    [trimmedQuery, likePattern, userId, safeLimit],
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

    const legacyResult = await client.query('select payload from app_state where id = $1 limit 1', [legacyStateRowId])
    const legacyState = legacyResult.rows[0]?.payload ?? null

    if (isPersistedAppState(legacyState)) {
      await replaceNormalizedState(client, legacyState, {
        userId: localUserId,
        recordRevisions: false,
        updateLegacySnapshot: false,
      })
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function readNormalizedState(client, userId = localUserId) {
  const workspaceIds = userId === localUserId ? [userId, legacyStateRowId] : [userId]

  const workspaceResult = await client.query(
    `
      select
        active_note_id as "activeNoteId",
        composer_history as "composerHistory"
      from workspace_state
      where id = any($1::text[])
      order by case when id = $2 then 0 else 1 end
      limit 1
    `,
    [workspaceIds, userId],
  )
  const folderResult = await client.query(
    `
      select
        id,
        name,
        parent_id as "parentId",
        collection_id as "collectionId"
      from folders
      where user_id = $1
      order by sort_order asc, id asc
    `,
    [userId],
  )
  const noteResult = await client.query(
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
        editor_doc as "editorDoc",
        updated_at as "updatedAt"
      from notes
      where user_id = $1
      order by sort_order asc, id asc
    `,
    [userId],
  )
  const blockResult = await client.query(
    `
      select
        note_blocks.id,
        note_blocks.note_id as "noteId",
        note_blocks.type,
        note_blocks.text_content as "text",
        note_blocks.items,
        note_blocks.citation
      from note_blocks
      join notes on notes.id = note_blocks.note_id
      where notes.user_id = $1
      order by note_blocks.note_id asc, note_blocks.position asc
    `,
    [userId],
  )
  const sourceResult = await client.query(
    `
      select
        note_sources.id,
        note_sources.note_id as "noteId",
        note_sources.source_type as "sourceType",
        note_sources.title,
        note_sources.author,
        note_sources.year,
        note_sources.publisher,
        note_sources.url,
        note_sources.note
      from note_sources
      join notes on notes.id = note_sources.note_id
      where notes.user_id = $1
      order by note_sources.note_id asc, note_sources.position asc
    `,
    [userId],
  )
  const tagResult = await client.query(
    `
      select
        note_tags.note_id as "noteId",
        note_tags.tag
      from note_tags
      join notes on notes.id = note_tags.note_id
      where notes.user_id = $1
      order by note_tags.note_id asc, note_tags.position asc
    `,
    [userId],
  )

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

  const sourcesByNoteId = new Map()

  for (const row of sourceResult.rows) {
    const sources = sourcesByNoteId.get(row.noteId) ?? []
    sources.push({
      id: row.id,
      sourceType: row.sourceType ?? 'other',
      title: row.title ?? '',
      author: row.author ?? '',
      year: row.year ?? '',
      publisher: row.publisher ?? '',
      url: row.url ?? '',
      note: row.note ?? '',
    })
    sourcesByNoteId.set(row.noteId, sources)
  }

  const notes = noteResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    collectionId: row.collectionId,
    folderId: row.folderId,
    status: row.status,
    blocks: blocksByNoteId.get(row.id) ?? [],
    editorDoc: row.editorDoc ?? null,
    sources: sourcesByNoteId.get(row.id) ?? [],
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
    composerHistory: Array.isArray(workspaceResult.rows[0]?.composerHistory)
      ? workspaceResult.rows[0].composerHistory
      : [],
    folders: folderResult.rows,
    notes,
  }
}

async function replaceNormalizedState(client, rawState, options) {
  const { userId = localUserId, recordRevisions = true, revisionEvents = [], updateLegacySnapshot = true } = options ?? {}
  const state = normalizePersistedAppState(rawState)

  if (recordRevisions) {
    await captureNoteRevisions(client, state.notes, revisionEvents, userId)
  }

  await client.query(
    `
      delete from note_links
      using notes
      where note_links.source_note_id = notes.id and notes.user_id = $1
    `,
    [userId],
  )
  await client.query(
    `
      delete from note_tags
      using notes
      where note_tags.note_id = notes.id and notes.user_id = $1
    `,
    [userId],
  )
  await client.query(
    `
      delete from note_blocks
      using notes
      where note_blocks.note_id = notes.id and notes.user_id = $1
    `,
    [userId],
  )
  await client.query(
    `
      delete from note_sources
      using notes
      where note_sources.note_id = notes.id and notes.user_id = $1
    `,
    [userId],
  )
  await client.query('delete from notes where user_id = $1', [userId])
  await client.query('delete from folders where user_id = $1', [userId])

  const validFolderIds = new Set(state.folders.map((folder) => folder.id))
  const sortedFolders = sortFoldersForPersistence(state.folders)

  for (const [index, folder] of sortedFolders.entries()) {
    await client.query(
      `
        insert into folders (id, user_id, name, parent_id, collection_id, sort_order, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
      `,
      [
        folder.id,
        userId,
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
          user_id,
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
          editor_doc,
          sort_order,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
      `,
      [
        note.id,
        userId,
        note.title,
        note.collectionId,
        note.folderId && validFolderIds.has(note.folderId) ? note.folderId : null,
        note.status,
        note.previewDate,
        Boolean(note.isFavorite),
        Boolean(note.isPinned),
        Boolean(note.isArchived),
        note.type ?? null,
        note.layout,
        note.editorDoc ? JSON.stringify(note.editorDoc) : null,
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

    for (const [sourceIndex, source] of (note.sources ?? []).entries()) {
      await client.query(
        `
          insert into note_sources (
            id,
            note_id,
            position,
            source_type,
            title,
            author,
            year,
            publisher,
            url,
            note
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          source.id,
          note.id,
          sourceIndex,
          source.sourceType ?? 'other',
          source.title ?? '',
          source.author ?? '',
          source.year ?? '',
          source.publisher ?? '',
          source.url ?? '',
          source.note ?? '',
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
      insert into workspace_state (id, active_note_id, composer_history, updated_at)
      values ($1, $2, $3::jsonb, now())
      on conflict (id)
      do update set
        active_note_id = excluded.active_note_id,
        composer_history = excluded.composer_history,
        updated_at = now()
    `,
    [userId, state.activeNoteId, JSON.stringify(state.composerHistory ?? [])],
  )

  if (updateLegacySnapshot) {
    await upsertLegacySnapshot(client, state, userId)
  }
}

async function captureNoteRevisions(client, nextNotes, revisionEvents = [], userId = localUserId) {
  const persistedNotesById = await readPersistedNotesById(client, userId)
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
        userId,
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
      userId,
      noteId,
      persistedEntry.snapshot.title ?? 'Untitled Note',
      'deleted',
      persistedEntry.snapshot,
      persistedEntry.snapshotHash,
    )
  }
}

async function readPersistedNotesById(client, userId = localUserId) {
  const state = await readNormalizedState(client, userId)
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

async function insertNoteRevision(client, userId, noteId, noteTitle, revisionKind, snapshot, snapshotHash) {
  await client.query(
    `
      insert into note_revisions (
        user_id,
        note_id,
        note_title,
        snapshot,
        snapshot_hash,
        revision_kind
      )
      values ($1, $2, $3, $4::jsonb, $5, $6)
    `,
    [userId, noteId, noteTitle, JSON.stringify(snapshot), snapshotHash, revisionKind],
  )
}

async function upsertLegacySnapshot(client, state, userId = localUserId) {
  await client.query(
    `
      insert into app_state (id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set payload = excluded.payload, updated_at = now()
    `,
    [userId, JSON.stringify(state)],
  )
}

function normalizePersistedAppState(value) {
  return {
    activeNoteId: typeof value?.activeNoteId === 'string' || value?.activeNoteId === null ? value.activeNoteId : null,
    composerHistory: Array.isArray(value?.composerHistory) ? value.composerHistory : [],
    folders: Array.isArray(value?.folders) ? value.folders : [],
    notes: Array.isArray(value?.notes) ? value.notes : [],
  }
}

function normalizeEmail(value) {
  const normalized = String(value ?? '').trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null
  }

  return normalized
}

function normalizeIdentityValue(value) {
  const normalized = String(value ?? '').trim()

  return normalized.length > 0 && normalized.length <= 256 ? normalized : null
}

function normalizeOptionalString(value, maxLength) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()

  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeDisplayName(value, email) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()

  return normalized.length > 0 && normalized.length <= 120 ? normalized : createDisplayName(email)
}

function createDisplayName(email) {
  const [namePart] = email.split('@')
  const normalizedName = String(namePart ?? '')
    .replace(/[._-]+/g, ' ')
    .trim()

  if (!normalizedName) {
    return 'Essence User'
  }

  return normalizedName.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function createSessionTokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function getSessionDurationMs() {
  const configuredDays = Number(process.env.AUTH_SESSION_DAYS ?? 30)
  const safeDays = Number.isFinite(configuredDays) ? Math.min(Math.max(configuredDays, 1), 365) : 30

  return safeDays * 24 * 60 * 60 * 1000
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
    editorDoc: note.editorDoc ?? null,
    sources: (note.sources ?? []).map((source) => ({
      id: source.id,
      sourceType: source.sourceType ?? 'other',
      title: source.title ?? '',
      author: source.author ?? '',
      year: source.year ?? '',
      publisher: source.publisher ?? '',
      url: source.url ?? '',
      note: source.note ?? '',
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
