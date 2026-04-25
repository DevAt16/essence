import 'dotenv/config'

import { readFile } from 'node:fs/promises'

import { ensureSchema, pool, saveAppState } from './db.mjs'

const seedPath = new URL('./seeds/cliodynamics-state.json', import.meta.url)

try {
  await ensureSchema()

  const raw = await readFile(seedPath, 'utf8')
  const state = JSON.parse(raw)

  await saveAppState(state)

  console.log(`Seeded PostgreSQL with ${state.notes?.length ?? 0} Cliodynamics notes.`)
} finally {
  await pool.end()
}
