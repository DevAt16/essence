import 'dotenv/config'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import {
  app,
  clearRateLimitBucketsForTests,
  createCodexCliOutputSchema,
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
  await pool.query("delete from users where email like 'gate1-test-%@example.com'")

  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

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
  assert.equal(typeof response.body.checks.aiAccess, 'string')
  assert.equal(typeof response.body.checks.aiModel, 'string')
  assert.equal(typeof response.body.checks.aiProvider, 'string')
})

test('ready endpoint reports Gemini CLI Composer provider', async () => {
  const previousAiEnabled = process.env.AI_ENABLED
  const previousAiProvider = process.env.AI_PROVIDER
  const previousGeminiCliModel = process.env.GEMINI_CLI_MODEL

  process.env.AI_ENABLED = 'true'
  process.env.AI_PROVIDER = 'gemini-cli'
  process.env.GEMINI_CLI_MODEL = 'gemini-cli-test-model'

  try {
    const response = await apiRequest('/api/ready', undefined, { method: 'GET' })

    assert.equal(response.status, 200)
    assert.equal(response.body.checks.aiComposer, 'ok')
    assert.equal(response.body.checks.aiModel, 'gemini-cli-test-model')
    assert.equal(response.body.checks.aiProvider, 'gemini-cli')
  } finally {
    restoreEnvValue('AI_ENABLED', previousAiEnabled)
    restoreEnvValue('AI_PROVIDER', previousAiProvider)
    restoreEnvValue('GEMINI_CLI_MODEL', previousGeminiCliModel)
  }
})

test('ready endpoint reports Codex CLI Composer provider', async () => {
  const previousAiEnabled = process.env.AI_ENABLED
  const previousAiProvider = process.env.AI_PROVIDER
  const previousCodexCliModel = process.env.CODEX_CLI_MODEL

  process.env.AI_ENABLED = 'true'
  process.env.AI_PROVIDER = 'codex-cli'
  process.env.CODEX_CLI_MODEL = 'codex-cli-test-model'

  try {
    const response = await apiRequest('/api/ready', undefined, { method: 'GET' })

    assert.equal(response.status, 200)
    assert.equal(response.body.checks.aiComposer, 'ok')
    assert.equal(response.body.checks.aiModel, 'codex-cli-test-model')
    assert.equal(response.body.checks.aiProvider, 'codex-cli')
  } finally {
    restoreEnvValue('AI_ENABLED', previousAiEnabled)
    restoreEnvValue('AI_PROVIDER', previousAiProvider)
    restoreEnvValue('CODEX_CLI_MODEL', previousCodexCliModel)
  }
})

test('Codex CLI output schema makes optional object fields nullable and required', () => {
  const schema = createCodexCliOutputSchema({
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['paragraph', 'heading', 'quote', 'bullet-list', 'code'],
            },
            text: {
              type: 'string',
            },
            items: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            citation: {
              type: 'string',
            },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['blocks'],
    additionalProperties: false,
  })

  const blockSchema = schema.properties.blocks.items

  assert.deepEqual(blockSchema.required, ['type', 'text', 'items', 'citation'])
  assert.equal(blockSchema.properties.type.type, 'string')
  assert.deepEqual(blockSchema.properties.text.type, ['string', 'null'])
  assert.deepEqual(blockSchema.properties.items.type, ['array', 'null'])
  assert.deepEqual(blockSchema.properties.citation.type, ['string', 'null'])
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

test('approved emails can request a sign-in code through the API gate', async () => {
  const email = uniqueEmail('code-approved')
  const fakeSupabase = createFakeSupabaseOtpClient()
  await approveUserEmail(email, { approvedBy: 'test' })
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/request-code', {
    email,
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(fakeSupabase.requests.length, 1)
  assert.equal(fakeSupabase.requests[0].email, email)
  assert.equal(fakeSupabase.requests[0].options.shouldCreateUser, false)
  assert.equal(fakeSupabase.requests[0].options.emailRedirectTo, undefined)
})

test('approved emails can verify a sign-in code and receive a Supabase session', async () => {
  const email = uniqueEmail('code-verify')
  const fakeSupabase = createFakeSupabaseOtpClient()
  await approveUserEmail(email, { approvedBy: 'test' })
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/verify-code', {
    code: '123 456',
    email,
    state: {
      activeNoteId: null,
      composerHistory: [],
      collections: [],
      folders: [],
      notes: [],
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(fakeSupabase.verifications.length, 1)
  assert.deepEqual(fakeSupabase.verifications[0], {
    email,
    token: '123456',
    type: 'email',
  })
  assert.equal(response.body.session.access_token, 'fake-access-token')
  assert.equal(response.body.session.refresh_token, 'fake-refresh-token')
  assert.equal(response.body.user.email, email)
  assert.equal(response.body.user.isLocal, false)
  assert.deepEqual(response.body.state.notes, [])
})

test('unapproved emails cannot verify sign-in codes', async () => {
  const fakeSupabase = createFakeSupabaseOtpClient()
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/verify-code', {
    code: '123456',
    email: uniqueEmail('code-unapproved'),
  })

  assert.equal(response.status, 403)
  assert.equal(fakeSupabase.verifications.length, 0)
})

test('sign-in code verification requires a code-shaped token', async () => {
  const email = uniqueEmail('code-invalid')
  const fakeSupabase = createFakeSupabaseOtpClient()
  await approveUserEmail(email, { approvedBy: 'test' })
  setSupabaseOtpClientForTests(fakeSupabase)

  const response = await apiRequest('/api/auth/verify-code', {
    code: '12',
    email,
  })

  assert.equal(response.status, 400)
  assert.equal(fakeSupabase.verifications.length, 0)
  assert.match(response.body.error, /code/i)
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
  const previousLocalAiUser = process.env.AI_ALLOW_LOCAL_USER

  process.env.AI_ALLOW_LOCAL_USER = 'false'

  try {
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
  } finally {
    restoreEnvValue('AI_ALLOW_LOCAL_USER', previousLocalAiUser)
  }
})

test('local Composer opt-in allows unauthenticated local AI requests', async () => {
  const previousAiEnabled = process.env.AI_ENABLED
  const previousLocalAiUser = process.env.AI_ALLOW_LOCAL_USER

  process.env.AI_ENABLED = 'false'
  process.env.AI_ALLOW_LOCAL_USER = 'true'

  try {
    const response = await apiRequest('/api/ai/draft', {
      category: 'essay',
      topic: 'consciousness',
    })

    assert.equal(response.status, 503)
    assert.match(response.body.error, /disabled/i)
  } finally {
    restoreEnvValue('AI_ENABLED', previousAiEnabled)
    restoreEnvValue('AI_ALLOW_LOCAL_USER', previousLocalAiUser)
  }
})

test('workspace saves reject stale workspace versions', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDevLogin = process.env.AUTH_DEV_EMAIL_LOGIN

  process.env.NODE_ENV = 'development'
  process.env.AUTH_DEV_EMAIL_LOGIN = 'true'

  try {
    const loginResponse = await apiRequest('/api/auth/login', {
      email: uniqueEmail('workspace-version'),
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
    assert.equal(typeof loginResponse.body.workspaceVersion, 'string')

    const firstVersion = loginResponse.body.workspaceVersion
    const firstSaveResponse = await apiRequest(
      '/api/state',
      {
        expectedWorkspaceVersion: firstVersion,
        state: createVersionedWorkspaceState('version-a', 'Version A'),
      },
      {
        headers: {
          Cookie: sessionCookie,
        },
        method: 'PUT',
      },
    )

    assert.equal(firstSaveResponse.status, 200)
    assert.equal(typeof firstSaveResponse.body.workspaceVersion, 'string')
    assert.notEqual(firstSaveResponse.body.workspaceVersion, firstVersion)

    const staleSaveResponse = await apiRequest(
      '/api/state',
      {
        expectedWorkspaceVersion: firstVersion,
        state: createVersionedWorkspaceState('version-b', 'Version B'),
      },
      {
        headers: {
          Cookie: sessionCookie,
        },
        method: 'PUT',
      },
    )

    assert.equal(staleSaveResponse.status, 409)
    assert.equal(staleSaveResponse.body.workspaceVersion, firstSaveResponse.body.workspaceVersion)

    const currentStateResponse = await apiRequest('/api/state', undefined, {
      headers: {
        Cookie: sessionCookie,
      },
      method: 'GET',
    })

    assert.equal(currentStateResponse.status, 200)
    assert.equal(currentStateResponse.body.state.notes.length, 1)
    assert.equal(currentStateResponse.body.state.notes[0].title, 'Version A')
  } finally {
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    restoreEnvValue('AUTH_DEV_EMAIL_LOGIN', previousDevLogin)
  }
})

test('workspace data stays isolated when users reuse note ids', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDevLogin = process.env.AUTH_DEV_EMAIL_LOGIN

  process.env.NODE_ENV = 'development'
  process.env.AUTH_DEV_EMAIL_LOGIN = 'true'

  try {
    const firstLoginResponse = await apiRequest('/api/auth/login', {
      email: uniqueEmail('tenant-collision-a'),
      state: createEmptyWorkspaceState(),
    })
    const secondLoginResponse = await apiRequest('/api/auth/login', {
      email: uniqueEmail('tenant-collision-b'),
      state: createEmptyWorkspaceState(),
    })
    const firstSessionCookie = firstLoginResponse.headers.get('set-cookie')?.split(';')[0]
    const secondSessionCookie = secondLoginResponse.headers.get('set-cookie')?.split(';')[0]

    assert.equal(firstLoginResponse.status, 200)
    assert.equal(secondLoginResponse.status, 200)
    assert.ok(firstSessionCookie)
    assert.ok(secondSessionCookie)

    const firstSaveResponse = await apiRequest(
      '/api/state',
      {
        expectedWorkspaceVersion: firstLoginResponse.body.workspaceVersion,
        state: createCollidingWorkspaceState('Tenant A'),
      },
      {
        headers: {
          Cookie: firstSessionCookie,
        },
        method: 'PUT',
      },
    )
    const secondSaveResponse = await apiRequest(
      '/api/state',
      {
        expectedWorkspaceVersion: secondLoginResponse.body.workspaceVersion,
        state: createCollidingWorkspaceState('Tenant B'),
      },
      {
        headers: {
          Cookie: secondSessionCookie,
        },
        method: 'PUT',
      },
    )

    assert.equal(firstSaveResponse.status, 200)
    assert.equal(secondSaveResponse.status, 200)

    await ensureSchema()

    const firstStateResponse = await apiRequest('/api/state', undefined, {
      headers: {
        Cookie: firstSessionCookie,
      },
      method: 'GET',
    })
    const secondStateResponse = await apiRequest('/api/state', undefined, {
      headers: {
        Cookie: secondSessionCookie,
      },
      method: 'GET',
    })
    const firstSharedNote = firstStateResponse.body.state.notes.find((note) => note.id === 'shared-note')
    const secondSharedNote = secondStateResponse.body.state.notes.find((note) => note.id === 'shared-note')

    assert.equal(firstStateResponse.status, 200)
    assert.equal(secondStateResponse.status, 200)
    assert.equal(firstSharedNote.title, 'Tenant A Workspace')
    assert.equal(secondSharedNote.title, 'Tenant B Workspace')
    assert.equal(firstSharedNote.blocks[0].text, 'Tenant A body links to [[Reference]]')
    assert.equal(secondSharedNote.blocks[0].text, 'Tenant B body links to [[Reference]]')
    assert.equal(firstSharedNote.sources[0].title, 'Tenant A source')
    assert.equal(secondSharedNote.sources[0].title, 'Tenant B source')

    const firstSearchResponse = await apiRequest('/api/search?q=Tenant%20A', undefined, {
      headers: {
        Cookie: firstSessionCookie,
      },
      method: 'GET',
    })
    const secondSearchResponse = await apiRequest('/api/search?q=Tenant%20A', undefined, {
      headers: {
        Cookie: secondSessionCookie,
      },
      method: 'GET',
    })

    assert.equal(firstSearchResponse.status, 200)
    assert.equal(secondSearchResponse.status, 200)
    assert.deepEqual(firstSearchResponse.body.results.map((result) => result.noteId), ['shared-note'])
    assert.deepEqual(secondSearchResponse.body.results, [])
  } finally {
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    restoreEnvValue('AUTH_DEV_EMAIL_LOGIN', previousDevLogin)
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
  const verifications = []

  return {
    requests,
    verifications,
    auth: {
      async signInWithOtp(request) {
        requests.push(request)
        return { data: {}, error: null }
      },
      async verifyOtp(request) {
        verifications.push(request)
        return {
          data: {
            session: {
              access_token: 'fake-access-token',
              expires_at: 1_789_999_999,
              refresh_token: 'fake-refresh-token',
            },
            user: {
              email: request.email,
              id: `supabase-${request.email}`,
              user_metadata: {
                full_name: 'Test Invited User',
              },
            },
          },
          error: null,
        }
      },
    },
  }
}

function uniqueEmail(label) {
  return `gate1-test-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
}

function createEmptyWorkspaceState() {
  return {
    activeNoteId: null,
    composerHistory: [],
    folders: [],
    notes: [],
  }
}

function createCollidingWorkspaceState(ownerLabel) {
  const now = new Date().toISOString()

  return {
    activeNoteId: 'shared-note',
    composerHistory: [],
    folders: [
      {
        id: 'shared-folder',
        name: `${ownerLabel} Folder`,
        parentId: null,
        collectionId: 'ideas',
      },
    ],
    notes: [
      {
        id: 'shared-note',
        title: `${ownerLabel} Workspace`,
        collectionId: 'ideas',
        folderId: 'shared-folder',
        status: 'Draft',
        blocks: [
          {
            id: 'block-shared-note',
            type: 'paragraph',
            text: `${ownerLabel} body links to [[Reference]]`,
          },
        ],
        editorDoc: null,
        sources: [
          {
            id: 'source-shared-note',
            sourceType: 'web',
            title: `${ownerLabel} source`,
            author: '',
            year: '',
            publisher: '',
            url: 'https://example.com/reference',
            note: '',
          },
        ],
        tags: ['shared-tag'],
        previewDate: 'Just now',
        updatedAt: now,
        isFavorite: false,
        isPinned: false,
        isArchived: false,
        layout: 'standard',
      },
      {
        id: 'linked-note',
        title: 'Reference',
        collectionId: 'ideas',
        folderId: null,
        status: 'Draft',
        blocks: [
          {
            id: 'block-linked-note',
            type: 'paragraph',
            text: 'Reference body',
          },
        ],
        editorDoc: null,
        sources: [],
        tags: [],
        previewDate: 'Just now',
        updatedAt: now,
        isFavorite: false,
        isPinned: false,
        isArchived: false,
        layout: 'standard',
      },
    ],
  }
}

function createVersionedWorkspaceState(noteId, title) {
  return {
    activeNoteId: noteId,
    composerHistory: [],
    folders: [],
    notes: [
      {
        id: noteId,
        title,
        collectionId: 'ideas',
        folderId: null,
        status: 'Draft',
        blocks: [
          {
            id: `block-${noteId}`,
            type: 'paragraph',
            text: title,
          },
        ],
        editorDoc: null,
        sources: [],
        tags: [],
        previewDate: 'Just now',
        updatedAt: new Date().toISOString(),
        isFavorite: false,
        isPinned: false,
        isArchived: false,
        layout: 'standard',
      },
    ],
  }
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
