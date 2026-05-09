import 'dotenv/config'

import { ensureSchema, pool } from './db.mjs'

try {
  await ensureSchema()
  console.log('PostgreSQL schema is ready.')
} finally {
  await pool.end()
}
