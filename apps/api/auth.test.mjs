import 'dotenv/config'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import {
  app,
  clearRateLimitBucketsForTests,
  setSupabaseOtpClientForTests,
} from './index.mjs'
import {
  approveUserEmail,
  ensureSchema,
  pool,
  revokeApprovedUserEmail,
} from './db.mjs'

let server
let baseUrl

before(async () => {
  await ensureSchema()
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
})

beforeEach(() => {
  clearRateLimitBucketsForTests()
  setSupabaseOtpClientForTests(createFakeSupabaseOtpClient())
})

after(async () => {
  await pool.query("delete from approved_users where email like 'gate1-test-%@example.com'")
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  await pool.end()
})

test('unapproved emails cannot request Supabase sign-in links', async () => {
  const fakeSupabase = createFakeSupabaseOtpClient()
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/request-link', {
    email: uniqueEmail('unapproved'),
    redirectTo: baseUrl,
  })

  assert.equal(response.status, 403)
  assert.equal(fakeSupabase.requests.length, 0)
  assert.match(response.body.error, /not invited/i)
})

test('approved emails can request a sign-in link through the API gate', async () => {
  const email = uniqueEmail('approved')
  const fakeSupabase = createFakeSupabaseOtpClient()
  await approveUserEmail(email, { approvedBy: 'test' })
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/request-link', {
    email,
    redirectTo: baseUrl,
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(fakeSupabase.requests.length, 1)
  assert.equal(fakeSupabase.requests[0].email, email)
  assert.equal(fakeSupabase.requests[0].options.shouldCreateUser, false)
})

test('revoked approved users cannot request sign-in links', async () => {
  const email = uniqueEmail('revoked')
  const fakeSupabase = createFakeSupabaseOtpClient()
  await approveUserEmail(email, { approvedBy: 'test' })
  await revokeApprovedUserEmail(email)
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/request-link', {
    email,
    redirectTo: baseUrl,
  })

  assert.equal(response.status, 403)
  assert.equal(fakeSupabase.requests.length, 0)
})

test('workspace endpoints reject unauthenticated requests', async () => {
  const protectedRequests = [
    ['GET', '/api/state'],
    ['GET', '/api/search?q=test'],
    ['GET', '/api/notes/note-test/revisions'],
    ['POST', '/api/ai/draft', { category: 'essay', topic: 'consciousness' }],
    ['POST', '/api/ai/assist', {
      action: 'continue-writing',
      note: {
        selectedText: '',
        status: 'Draft',
        tags: [],
        text: 'A short note body',
        title: 'Test note',
      },
    }],
    ['PUT', '/api/state', {
      state: {
        activeNoteId: null,
        composerHistory: [],
        folders: [],
        notes: [],
      },
    }],
  ]

  for (const [method, path, body] of protectedRequests) {
    const response = await apiRequest(path, body, { method })
    assert.equal(response.status, 401, `${method} ${path}`)
  }
})

test('development email login cannot be enabled in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDevLogin = process.env.AUTH_DEV_EMAIL_LOGIN

  process.env.NODE_ENV = 'production'
  process.env.AUTH_DEV_EMAIL_LOGIN = 'true'

  try {
    const response = await apiRequest('/api/auth/login', {
      email: uniqueEmail('dev-login'),
      state: {
        activeNoteId: null,
        composerHistory: [],
        folders: [],
        notes: [],
      },
    })

    assert.equal(response.status, 501)
    assert.match(response.body.error, /disabled/i)
  } finally {
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    restoreEnvValue('AUTH_DEV_EMAIL_LOGIN', previousDevLogin)
  }
})

test('development email login requires explicit local opt-in', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDevLogin = process.env.AUTH_DEV_EMAIL_LOGIN

  process.env.NODE_ENV = 'development'
  delete process.env.AUTH_DEV_EMAIL_LOGIN

  try {
    const response = await apiRequest('/api/auth/login', {
      email: uniqueEmail('dev-login-default'),
      state: {
        activeNoteId: null,
        composerHistory: [],
        folders: [],
        notes: [],
      },
    })

    assert.equal(response.status, 501)
    assert.match(response.body.error, /disabled/i)
  } finally {
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    restoreEnvValue('AUTH_DEV_EMAIL_LOGIN', previousDevLogin)
  }
})

async function apiRequest(path, body, options = {}) {
  const method = options.method ?? 'POST'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()

  return {
    body: text ? JSON.parse(text) : null,
    status: response.status,
  }
}

function createFakeSupabaseOtpClient() {
  const requests = []

  return {
    requests,
    auth: {
      async signInWithOtp(request) {
        requests.push(request)
        return { data: {}, error: null }
      },
    },
  }
}

function uniqueEmail(label) {
  return `gate1-test-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
