import 'dotenv/config'

import express from 'express'

import { ensureSchema, getAppState, getNoteRevisions, pool, saveAppState, searchNotes } from './db.mjs'

const port = Number(process.env.PORT ?? 4000)
const app = express()

app.use(express.json({ limit: '5mb' }))

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('select 1')
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/state', async (_request, response, next) => {
  try {
    const state = await getAppState()
    response.json({ state })
  } catch (error) {
    next(error)
  }
})

app.get('/api/notes/:noteId/revisions', async (request, response, next) => {
  try {
    const { noteId } = request.params
    const limit = Number(request.query.limit ?? 20)
    const revisions = await getNoteRevisions(noteId, limit)
    response.json({ revisions })
  } catch (error) {
    next(error)
  }
})

app.get('/api/search', async (request, response, next) => {
  try {
    const query = String(request.query.q ?? '')
    const limit = Number(request.query.limit ?? 24)
    const results = await searchNotes(query, limit)
    response.json({ results })
  } catch (error) {
    next(error)
  }
})

app.put('/api/state', async (request, response, next) => {
  try {
    const { revisionEvents, state } = request.body ?? {}

    if (!isPersistedAppState(state)) {
      response.status(400).json({
        error: 'Expected a state payload with activeNoteId, folders, and notes.',
      })
      return
    }

    await saveAppState(state, { revisionEvents: normalizeRevisionEvents(revisionEvents) })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

await ensureSchema()

const server = app.listen(port, () => {
  console.log(`Essence API listening on http://localhost:${port}`)
})

async function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down...`)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

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

function normalizeRevisionEvents(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const noteId = typeof entry.noteId === 'string' ? entry.noteId : null
    const revisionKind = typeof entry.revisionKind === 'string' ? entry.revisionKind : null

    return noteId && revisionKind ? [{ noteId, revisionKind }] : []
  })
}
