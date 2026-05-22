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
let previousRequestLogging

before(async () => {
  previousRequestLogging = process.env.REQUEST_LOGGING
  process.env.REQUEST_LOGGING = 'false'
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
  restoreEnvValue('REQUEST_LOGGING', previousRequestLogging)
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

test('health endpoint returns API liveness metadata', async () => {
  const response = await apiRequest('/api/health', undefined, { method: 'GET' })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.service, 'essence-api')
  assert.equal(typeof response.body.uptimeSeconds, 'number')
  assert.match(response.headers.get('x-request-id'), /^[a-zA-Z0-9_.:-]{8,128}$/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/)
})

test('ready endpoint verifies database readiness', async () => {
  const response = await apiRequest('/api/ready', undefined, { method: 'GET' })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.checks.database, 'ok')
})

test('CORS preflight allows configured development origin', async () => {
  const response = await apiRequest('/api/state', undefined, {
    headers: {
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
      'Access-Control-Request-Method': 'PUT',
      Origin: 'http://localhost:5173',
    },
    method: 'OPTIONS',
  })

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.match(response.headers.get('access-control-allow-methods'), /PUT/)
})

test('CORS preflight rejects unknown origins', async () => {
  const response = await apiRequest('/api/state', undefined, {
    headers: {
      'Access-Control-Request-Method': 'GET',
      Origin: 'https://not-essence.example',
    },
    method: 'OPTIONS',
  })

  assert.equal(response.status, 403)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
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
    ['PUT', '/api/profile', { displayName: 'Test User' }],
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

test('AI endpoints can be disabled without affecting account login', async () => {
  const previousAiEnabled = process.env.AI_ENABLED
  const previousNodeEnv = process.env.NODE_ENV
  const previousDevLogin = process.env.AUTH_DEV_EMAIL_LOGIN

  process.env.AI_ENABLED = 'false'
  process.env.NODE_ENV = 'development'
  process.env.AUTH_DEV_EMAIL_LOGIN = 'true'

  try {
    const loginResponse = await apiRequest('/api/auth/login', {
      email: uniqueEmail('ai-disabled'),
      state: {
        activeNoteId: null,
        composerHistory: [],
        folders: [],
        notes: [],
      },
    })
    const sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0]

    assert.equal(loginResponse.status, 200)
    assert.ok(sessionCookie)

    const response = await apiRequest(
      '/api/ai/draft',
      { category: 'essay', topic: 'consciousness' },
      {
        headers: {
          Cookie: sessionCookie,
        },
      },
    )

    assert.equal(response.status, 503)
    assert.match(response.body.error, /disabled/i)
  } finally {
    restoreEnvValue('AI_ENABLED', previousAiEnabled)
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    restoreEnvValue('AUTH_DEV_EMAIL_LOGIN', previousDevLogin)
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
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()

  return {
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
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
