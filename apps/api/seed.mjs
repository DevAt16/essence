import 'dotenv/config'

import { readFile } from 'node:fs/promises'

import { ensureSchema, getAppState, pool, saveAppState } from './db.mjs'

const seedFileName = process.env.SEED_FILE ?? 'essence-research-state.json'
const seedMode = process.env.SEED_MODE === 'replace' ? 'replace' : 'merge'
const seedPath = new URL(`./seeds/${seedFileName}`, import.meta.url)

try {
  await ensureSchema()

  const raw = await readFile(seedPath, 'utf8')
  const seedState = JSON.parse(raw)
  const currentState = seedMode === 'replace' ? null : await getAppState()
  const state = currentState ? mergeSeedState(currentState, seedState) : seedState

  await saveAppState(state, { recordRevisions: false })

  console.log(
    `Seeded PostgreSQL in ${seedMode} mode with ${seedState.notes?.length ?? 0} notes from ${seedFileName}.`,
  )
} finally {
  await pool.end()
}

function mergeSeedState(currentState, seedState) {
  const seedFolders = Array.isArray(seedState.folders) ? seedState.folders : []
  const currentFolders = Array.isArray(currentState.folders) ? currentState.folders : []
  const seedNotes = Array.isArray(seedState.notes) ? seedState.notes : []
  const currentNotes = Array.isArray(currentState.notes) ? currentState.notes : []
  const foldersById = new Map(seedFolders.map((folder) => [folder.id, folder]))
  const notesById = new Map(seedNotes.map((note) => [note.id, note]))

  for (const folder of currentFolders) {
    if (!foldersById.has(folder.id)) {
      foldersById.set(folder.id, folder)
    }
  }

  for (const note of currentNotes) {
    if (!notesById.has(note.id)) {
      notesById.set(note.id, note)
    }
  }

  return {
    activeNoteId: seedState.activeNoteId ?? currentState.activeNoteId ?? seedNotes[0]?.id ?? currentNotes[0]?.id ?? null,
    composerHistory: Array.isArray(currentState.composerHistory) ? currentState.composerHistory : [],
    folders: Array.from(foldersById.values()),
    notes: Array.from(notesById.values()),
  }
}
