import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import express from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import {
  createUserSession,
  deleteUserSession,
  ensureSchema,
  getAppState,
  getLocalUser,
  getNoteRevisions,
  getOrCreateExternalUser,
  getOrCreateUserByEmail,
  getUserBySessionToken,
  isApprovedUserEmail,
  localUserId,
  pool,
  saveAppState,
  searchNotes,
} from './db.mjs'

const port = Number(process.env.PORT ?? 4000)
const app = express()
const rateLimitBuckets = new Map()
const supabaseAuthConfig = createSupabaseAuthConfig()
const supabaseJwks = supabaseAuthConfig
  ? createRemoteJWKSet(new URL(`${supabaseAuthConfig.issuer}/.well-known/jwks.json`))
  : null

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1)
}

app.use('/api', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})

app.use(express.json({ limit: '5mb' }))

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('select 1')
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/session', async (request, response, next) => {
  try {
    const user = await getAccountUserFromRequest(request)

    if (!user) {
      const localUser = await getRequestUser({ headers: {} })
      response.json({ state: null, user: serializeUser(localUser) })
      return
    }

    const state = await getAppState(user.id)

    response.json({ state, user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  try {
    enforceRateLimit(request, 'auth-login', getAuthRateLimitOptions(), normalizeRateLimitSubject(request.body?.email))

    if (!isDevEmailLoginEnabled()) {
      const error = new Error(
        'Email-only development login is disabled. Use a configured production auth provider, or set AUTH_DEV_EMAIL_LOGIN=true for local development.',
      )
      error.status = 501
      throw error
    }

    const { email, state } = request.body ?? {}
    const user = await getOrCreateUserByEmail(email)

    if (!user) {
      response.status(400).json({ error: 'Enter a valid email address.' })
      return
    }

    let accountState = await getAppState(user.id)

    if (!accountState && isPersistedAppState(state)) {
      accountState = cloneStateForAccount(state)
      await saveAppState(accountState, {
        userId: user.id,
        recordRevisions: false,
      })
    }

    const session = await createUserSession(user.id)
    setSessionCookie(response, session.token, session.expiresAt)

    response.json({
      state: accountState ?? createEmptyPersistedState(),
      user: serializeUser(user),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    await deleteUserSession(getSessionToken(request))
    clearSessionCookie(response)

    const user = await getRequestUser({ headers: {} })

    response.json({ state: createEmptyPersistedState(), user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/state', async (request, response, next) => {
  try {
    const user = await requireAccountUser(request)
    const state = await getAppState(user.id)
    response.json({ state, user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/notes/:noteId/revisions', async (request, response, next) => {
  try {
    const user = await requireAccountUser(request)
    const { noteId } = request.params
    const limit = Number(request.query.limit ?? 20)
    const revisions = await getNoteRevisions(noteId, limit, user.id)
    response.json({ revisions })
  } catch (error) {
    next(error)
  }
})

app.get('/api/search', async (request, response, next) => {
  try {
    const user = await requireAccountUser(request)
    const query = String(request.query.q ?? '')
    const limit = Number(request.query.limit ?? 24)
    const results = await searchNotes(query, limit, user.id)
    response.json({ results })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ai/draft', async (request, response, next) => {
  try {
    enforceRateLimit(request, 'ai-draft-ip', getAiRateLimitOptions())
    const user = await requireAccountUser(request)
    enforceRateLimit(request, 'ai-draft-user', getAiRateLimitOptions(), user.id)

    const requestContext = normalizeAiDraftRequest(request.body)

    if (!requestContext.ok) {
      response.status(400).json({ error: requestContext.error })
      return
    }

    const rawDraft = await generateGeminiJson(
      buildGeminiDraftPrompt(requestContext.topic, requestContext.meta),
      geminiDraftResponseSchema,
      { temperature: 0.72 },
    )
    const draft = normalizeAiDraft(rawDraft, requestContext)

    response.json({ draft })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ai/assist', async (request, response, next) => {
  try {
    enforceRateLimit(request, 'ai-assist-ip', getAiRateLimitOptions())
    const user = await requireAccountUser(request)
    enforceRateLimit(request, 'ai-assist-user', getAiRateLimitOptions(), user.id)

    const requestContext = normalizeAiAssistRequest(request.body)

    if (!requestContext.ok) {
      response.status(400).json({ error: requestContext.error })
      return
    }

    const rawResult = await generateGeminiJson(
      buildGeminiAssistPrompt(requestContext),
      geminiAssistResponseSchema,
      { temperature: requestContext.meta.temperature },
    )
    const result = normalizeAiAssistResult(rawResult, requestContext)

    response.json({ result })
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

    const user = await requireAccountUser(request)
    await saveAppState(state, {
      userId: user.id,
      revisionEvents: normalizeRevisionEvents(revisionEvents),
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  const statusCode = Number.isInteger(error?.status) ? error.status : 500
  if (Number.isInteger(error?.retryAfterSeconds)) {
    response.setHeader('Retry-After', String(error.retryAfterSeconds))
  }
  response.status(statusCode).json({ error: statusCode === 500 ? 'Internal server error' : error.message })
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

const aiDraftCategoryMeta = {
  article: {
    collectionId: 'research',
    guidance:
      'Write a clear explanatory article for students and researchers. Use an accessible introduction, several well-structured sections, and a concise closing synthesis.',
    label: 'Article',
    layout: 'feature',
    noteType: undefined,
    status: 'Article',
    tag: 'article',
  },
  essay: {
    collectionId: 'research',
    guidance:
      'Write an original argumentative essay. Establish a thesis, develop it with careful reasoning, and end with a reflective conclusion.',
    label: 'Essay',
    layout: 'feature',
    noteType: undefined,
    status: 'Essay',
    tag: 'essay',
  },
  quote: {
    collectionId: 'ideas',
    guidance:
      'Write one original aphoristic quote, then add a short reflective note that explains the thought without over-explaining it.',
    label: 'Quote',
    layout: 'quote',
    noteType: 'quote',
    status: 'Quote',
    tag: 'quote',
  },
  'research-topic': {
    collectionId: 'research',
    guidance:
      'Create a research brief. Include a working framing, research questions, possible hypotheses, methods, and what to verify next.',
    label: 'Research Topic',
    layout: 'standard',
    noteType: undefined,
    status: 'Research',
    tag: 'research-topic',
  },
}

const aiAssistActionMeta = {
  'continue-writing': {
    label: 'Continue writing',
    guidance:
      'Continue the current note with 2 to 4 coherent blocks. Match the existing tone and structure. Do not summarize what is already written.',
    temperature: 0.72,
  },
  'improve-clarity': {
    label: 'Improve clarity',
    guidance:
      'Improve clarity and flow. If selected text is provided, return replacement blocks for that selected text only. If no selection is provided, return a concise clarity pass as insertable blocks.',
    temperature: 0.54,
  },
  'create-outline': {
    label: 'Create outline',
    guidance:
      'Create a clean outline for the note. Use headings and bullet lists that reveal structure, gaps, and next sections to write.',
    temperature: 0.5,
  },
  'study-questions': {
    label: 'Study questions',
    guidance:
      'Create study material from the note: key questions, short answer prompts, and concepts to review. Prefer bullet lists and concise headings.',
    temperature: 0.48,
  },
  counterarguments: {
    label: 'Counterarguments',
    guidance:
      'Create a thoughtful counterargument layer for the note. Identify objections, assumptions, tensions, alternate interpretations, and what would weaken or strengthen the central claim. Prefer concise headings and bullet lists.',
    temperature: 0.56,
  },
  'reading-list': {
    label: 'Reading list',
    guidance:
      'Create a research path from the note. Do not invent exact citations, URLs, or papers. Suggest source categories, search queries, canonical areas to investigate, and verification steps. Prefer headings and bullet lists.',
    temperature: 0.5,
  },
}

const geminiDraftResponseSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'A concise title for the generated note.',
    },
    summary: {
      type: 'string',
      description: 'A one-sentence summary of the note.',
    },
    status: {
      type: 'string',
      description: 'A short category/status label for the note.',
    },
    tags: {
      type: 'array',
      description: 'Short lowercase topic tags.',
      minItems: 2,
      maxItems: 6,
      items: {
        type: 'string',
      },
    },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
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
  required: ['title', 'summary', 'status', 'tags', 'blocks'],
  additionalProperties: false,
}

const geminiAssistResponseSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'A concise label for the assistance result.',
    },
    summary: {
      type: 'string',
      description: 'A one-sentence explanation of what changed or was generated.',
    },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
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
  required: ['title', 'summary', 'blocks'],
  additionalProperties: false,
}

const supportedDraftBlockTypes = new Set(['paragraph', 'heading', 'quote', 'bullet-list', 'code'])

function normalizeAiDraftRequest(body) {
  const topic = typeof body?.topic === 'string' ? body.topic.trim().replace(/\s+/g, ' ') : ''
  const category = typeof body?.category === 'string' ? body.category.trim() : ''
  const meta = aiDraftCategoryMeta[category]

  if (topic.length < 3) {
    return { ok: false, error: 'Enter a topic with at least 3 characters.' }
  }

  if (topic.length > 220) {
    return { ok: false, error: 'Keep the topic under 220 characters for now.' }
  }

  if (!meta) {
    return { ok: false, error: 'Choose Essay, Article, Research Topic, or Quote.' }
  }

  return {
    ok: true,
    category,
    meta,
    topic,
  }
}

function normalizeAiAssistRequest(body) {
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const meta = aiAssistActionMeta[action]
  const note = body?.note && typeof body.note === 'object' ? body.note : {}
  const title = normalizeDraftString(note.title, 'Untitled Note', 180)
  const status = normalizeDraftString(note.status, '', 60)
  const text = normalizeDraftString(note.text, '', 12000)
  const selectedText = normalizeDraftString(note.selectedText, '', 2600)
  const tags = Array.isArray(note.tags)
    ? note.tags.map((tag) => normalizeDraftString(tag, '', 40)).filter(Boolean).slice(0, 10)
    : []

  if (!meta) {
    return { ok: false, error: 'Choose Continue, Clarify, Outline, Study Questions, Counterarguments, or Reading List.' }
  }

  if (text.length < 3 && selectedText.length < 3) {
    return { ok: false, error: 'Open a note with a little content before using active-note Composer.' }
  }

  return {
    ok: true,
    action,
    meta,
    note: {
      selectedText,
      status,
      tags,
      text,
      title,
    },
  }
}

function buildGeminiDraftPrompt(topic, meta) {
  return [
    'You are Essence Composer, a quiet writing assistant for students, researchers, and deep readers.',
    `Topic: ${topic}`,
    `Requested note type: ${meta.label}`,
    meta.guidance,
    'Create original prose suitable for a minimalist note-taking app.',
    'Do not invent citations, studies, URLs, books, or source names. If the topic requires sources, include a short verification note instead of pretending sources were checked.',
    'Write in a calm, precise, intellectually useful style. Avoid hype, filler, and generic AI disclaimers.',
    'Return only JSON matching the schema. Use block types paragraph, heading, quote, bullet-list, or code.',
  ].join('\n\n')
}

function buildGeminiAssistPrompt(context) {
  const selectedSection = context.note.selectedText
    ? [`Selected block to focus on:`, context.note.selectedText].join('\n')
    : 'No selected block was provided. Work from the full note context.'

  return [
    'You are Essence Composer, an active-note assistant for students, researchers, and deep readers.',
    `Action: ${context.meta.label}`,
    context.meta.guidance,
    'Return only original, insertable Essence blocks. Do not invent citations, studies, URLs, books, or source names.',
    'If source verification is needed, include a short note telling the user what to verify rather than pretending it was checked.',
    `Note title: ${context.note.title}`,
    context.note.status ? `Note status: ${context.note.status}` : '',
    context.note.tags.length > 0 ? `Tags: ${context.note.tags.join(', ')}` : '',
    selectedSection,
    'Full note context:',
    context.note.text,
    'Return only JSON matching the schema.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function generateGeminiJson(prompt, schema, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()

  if (!apiKey) {
    const error = new Error('Gemini is not configured yet. Add GEMINI_API_KEY to your .env file and restart the server.')
    error.status = 503
    throw error
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview'
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: options.temperature ?? 0.64,
          topP: options.topP ?? 0.9,
        },
      }),
    },
  )

  const geminiPayload = await geminiResponse.json().catch(() => null)

  if (!geminiResponse.ok) {
    const upstreamMessage =
      typeof geminiPayload?.error?.message === 'string'
        ? geminiPayload.error.message
        : `Gemini request failed with status ${geminiResponse.status}.`
    const error = new Error(upstreamMessage)
    error.status = geminiResponse.status === 429 ? 429 : 502
    throw error
  }

  const responseText = extractGeminiText(geminiPayload)

  if (!responseText) {
    const error = new Error('Gemini returned an empty draft.')
    error.status = 502
    throw error
  }

  try {
    return parseJsonText(responseText)
  } catch {
    const error = new Error('Gemini returned content the app could not parse. Try again.')
    error.status = 502
    throw error
  }
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts

  if (!Array.isArray(parts)) {
    return ''
  }

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim()
}

function parseJsonText(value) {
  const trimmedValue = value.trim()
  const fencedMatch = trimmedValue.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmedValue

  return JSON.parse(jsonText)
}

function normalizeAiDraft(rawDraft, context) {
  const candidate = rawDraft && typeof rawDraft === 'object' ? rawDraft : {}
  const title = normalizeDraftString(candidate.title, `${context.meta.label}: ${context.topic}`, 140)
  const summary = normalizeDraftString(candidate.summary, '', 260)
  const status = normalizeDraftString(candidate.status, context.meta.status, 32) || context.meta.status
  const tags = normalizeDraftTags([...(Array.isArray(candidate.tags) ? candidate.tags : []), context.meta.tag, 'ai-draft'])
  const blocks = normalizeDraftBlocks(candidate.blocks, context)

  return {
    blocks,
    collectionId: context.meta.collectionId,
    layout: context.meta.layout,
    noteType: context.meta.noteType,
    status,
    summary,
    tags,
    title,
  }
}

function normalizeAiAssistResult(rawResult, context) {
  const candidate = rawResult && typeof rawResult === 'object' ? rawResult : {}
  const blocks = normalizeDraftBlocks(candidate.blocks, {
    category: 'assist',
    topic: context.note.title,
  })

  return {
    action: context.action,
    actionLabel: context.meta.label,
    blocks,
    canReplaceSelection: context.action === 'improve-clarity' && context.note.selectedText.length > 0,
    summary: normalizeDraftString(candidate.summary, '', 260),
    title: normalizeDraftString(candidate.title, context.meta.label, 140) || context.meta.label,
  }
}

function normalizeDraftBlocks(rawBlocks, context) {
  const blocks = Array.isArray(rawBlocks)
    ? rawBlocks.map(normalizeDraftBlock).filter((block) => block !== null)
    : []

  if (context.category === 'quote') {
    const quoteBlock = blocks.find((block) => block.type === 'quote')

    if (quoteBlock) {
      return [quoteBlock, ...blocks.filter((block) => block !== quoteBlock).slice(0, 3)]
    }

    const fallbackText = blocks.find((block) => typeof block.text === 'string' && block.text.trim())?.text

    return [
      {
        type: 'quote',
        text: fallbackText || `A quiet thought on ${context.topic}.`,
        citation: '',
      },
      ...blocks.slice(0, 2),
    ]
  }

  return blocks.length > 0
    ? blocks
    : [
        {
          type: 'paragraph',
          text: `Begin a note on ${context.topic}.`,
        },
      ]
}

function normalizeDraftBlock(rawBlock) {
  if (!rawBlock || typeof rawBlock !== 'object') {
    return null
  }

  const type = supportedDraftBlockTypes.has(rawBlock.type) ? rawBlock.type : 'paragraph'

  if (type === 'bullet-list') {
    const items = Array.isArray(rawBlock.items)
      ? rawBlock.items.map((item) => normalizeDraftString(item, '', 180)).filter(Boolean)
      : []

    return {
      type,
      items: items.length > 0 ? items.slice(0, 10) : ['Expand this point.'],
    }
  }

  const text = normalizeDraftString(rawBlock.text, '', type === 'heading' ? 120 : 3000)

  if (!text && type !== 'quote') {
    return null
  }

  if (type === 'quote') {
    return {
      type,
      text: text || 'A thought worth returning to.',
      citation: normalizeDraftString(rawBlock.citation, '', 120),
    }
  }

  if (type === 'code') {
    return {
      type,
      text,
    }
  }

  return {
    type,
    text,
  }
}

function normalizeDraftString(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : fallback

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`
}

function normalizeDraftTags(values) {
  const tags = values
    .map((value) =>
      typeof value === 'string'
        ? value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 36)
        : '',
    )
    .filter(Boolean)

  return [...new Set(tags)].slice(0, 8)
}

async function getRequestUser(request) {
  const sessionUser = await getAccountUserFromRequest(request)

  if (sessionUser) {
    return sessionUser
  }

  return (
    (await getLocalUser()) ?? {
      id: localUserId,
      email: 'local@essence.local',
      displayName: 'Local Workspace',
      isLocal: true,
    }
  )
}

async function requireAccountUser(request) {
  const sessionUser = await getAccountUserFromRequest(request)

  if (sessionUser) {
    return sessionUser
  }

  const error = new Error('Sign in required for workspace sync.')
  error.status = 401
  throw error
}

async function getAccountUserFromRequest(request) {
  const sessionUser = isDevEmailLoginEnabled() ? await getUserBySessionToken(getSessionToken(request)) : null

  if (sessionUser && !sessionUser.isLocal) {
    return sessionUser
  }

  return getSupabaseUserFromRequest(request)
}

async function getSupabaseUserFromRequest(request) {
  const token = getBearerToken(request)

  if (!token) {
    return null
  }

  if (!supabaseAuthConfig || !supabaseJwks) {
    const error = new Error('Supabase auth is not configured on the API.')
    error.status = 401
    throw error
  }

  let payload

  try {
    const result = await jwtVerify(token, supabaseJwks, {
      audience: supabaseAuthConfig.audience,
      issuer: supabaseAuthConfig.issuer,
    })
    payload = result.payload
  } catch {
    const error = new Error('Invalid or expired auth token.')
    error.status = 401
    throw error
  }

  const email = typeof payload.email === 'string' ? payload.email : null
  const subject = typeof payload.sub === 'string' ? payload.sub : null

  if (!email || !subject) {
    const error = new Error('Auth token is missing required user claims.')
    error.status = 401
    throw error
  }

  if (!(await isApprovedUserEmail(email))) {
    const error = new Error('This email is not invited to Essence yet.')
    error.status = 403
    throw error
  }

  const user = await getOrCreateExternalUser({
    displayName: getSupabaseDisplayName(payload),
    email,
    provider: 'supabase',
    subject,
  })

  if (!user) {
    const error = new Error('Unable to create account for authenticated user.')
    error.status = 401
    throw error
  }

  return user
}

function getSupabaseDisplayName(payload) {
  const metadata = payload.user_metadata && typeof payload.user_metadata === 'object' ? payload.user_metadata : {}
  const name = metadata.full_name ?? metadata.name ?? metadata.display_name

  return typeof name === 'string' ? name : null
}

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isLocal: Boolean(user.isLocal),
  }
}

function getSessionToken(request) {
  const cookieHeader = request?.headers?.cookie
  const cookies = parseCookies(cookieHeader)

  return cookies[getSessionCookieName()] ?? null
}

function getBearerToken(request) {
  const authorizationHeader = request?.headers?.authorization

  if (typeof authorizationHeader !== 'string') {
    return null
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2)

  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function parseCookies(cookieHeader) {
  return String(cookieHeader ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separatorIndex = cookie.indexOf('=')

      if (separatorIndex === -1) {
        return cookies
      }

      const key = decodeURIComponent(cookie.slice(0, separatorIndex).trim())
      const value = decodeURIComponent(cookie.slice(separatorIndex + 1).trim())

      cookies[key] = value
      return cookies
    }, {})
}

function setSessionCookie(response, token, expiresAt) {
  const maxAgeSeconds = Math.max(Math.floor((expiresAt.getTime() - Date.now()) / 1000), 0)
  response.setHeader(
    'Set-Cookie',
    [
      `${getSessionCookieName()}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
      process.env.AUTH_COOKIE_SECURE === 'true' ? 'Secure' : null,
    ]
      .filter(Boolean)
      .join('; '),
  )
}

function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    [
      `${getSessionCookieName()}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax',
      process.env.AUTH_COOKIE_SECURE === 'true' ? 'Secure' : null,
    ]
      .filter(Boolean)
      .join('; '),
  )
}

function getSessionCookieName() {
  return process.env.AUTH_COOKIE_NAME || 'essence_session'
}

function createSupabaseAuthConfig() {
  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const normalizedUrl = rawUrl.trim().replace(/\/+$/g, '')

  if (!normalizedUrl) {
    return null
  }

  return {
    audience: process.env.SUPABASE_JWT_AUDIENCE || 'authenticated',
    issuer: `${normalizedUrl}/auth/v1`,
  }
}

function isDevEmailLoginEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  if (process.env.AUTH_DEV_EMAIL_LOGIN === 'true') {
    return true
  }

  if (process.env.AUTH_DEV_EMAIL_LOGIN === 'false') {
    return false
  }

  return process.env.NODE_ENV !== 'production'
}

function enforceRateLimit(request, bucketName, options, subject = '') {
  const now = Date.now()
  const windowMs = Math.max(options.windowMs, 1_000)
  const max = Math.max(options.max, 1)
  const identifier = [bucketName, getRequestIp(request), subject].filter(Boolean).join(':')
  const currentBucket = rateLimitBuckets.get(identifier)

  if (!currentBucket || currentBucket.resetAt <= now) {
    rateLimitBuckets.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    })
    cleanupExpiredRateLimitBuckets(now)
    return
  }

  currentBucket.count += 1

  if (currentBucket.count <= max) {
    return
  }

  const error = new Error('Too many requests. Please wait a moment and try again.')
  error.status = 429
  error.retryAfterSeconds = Math.max(Math.ceil((currentBucket.resetAt - now) / 1000), 1)
  throw error
}

function cleanupExpiredRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 1_000) {
    return
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key)
    }
  }
}

function getAuthRateLimitOptions() {
  return {
    max: readPositiveIntegerEnv('AUTH_RATE_LIMIT_MAX', 8),
    windowMs: readPositiveIntegerEnv('AUTH_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1_000),
  }
}

function getAiRateLimitOptions() {
  return {
    max: readPositiveIntegerEnv('AI_RATE_LIMIT_MAX', 30),
    windowMs: readPositiveIntegerEnv('AI_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1_000),
  }
}

function readPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getRequestIp(request) {
  return String(request.ip ?? request.socket?.remoteAddress ?? 'unknown')
}

function normalizeRateLimitSubject(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 128) : ''
}

function createEmptyPersistedState() {
  return {
    activeNoteId: null,
    composerHistory: [],
    folders: [],
    notes: [],
  }
}

function cloneStateForAccount(state) {
  const folderIdMap = new Map(state.folders.map((folder) => [folder.id, createEntityId('folder')]))
  const noteIdMap = new Map(state.notes.map((note) => [note.id, createEntityId('note')]))

  return {
    activeNoteId: state.activeNoteId ? noteIdMap.get(state.activeNoteId) ?? null : null,
    composerHistory: Array.isArray(state.composerHistory) ? state.composerHistory : [],
    folders: state.folders.map((folder) => ({
      ...folder,
      id: folderIdMap.get(folder.id),
      parentId: folder.parentId ? folderIdMap.get(folder.parentId) ?? null : null,
    })),
    notes: state.notes.map((note) => ({
      ...note,
      id: noteIdMap.get(note.id),
      folderId: note.folderId ? folderIdMap.get(note.folderId) ?? null : null,
      editorDoc: note.editorDoc && typeof note.editorDoc === 'object' ? JSON.parse(JSON.stringify(note.editorDoc)) : null,
      blocks: Array.isArray(note.blocks)
        ? note.blocks.map((block) => ({
            ...block,
            id: createEntityId('block'),
            items: Array.isArray(block.items) ? [...block.items] : block.items,
          }))
        : [],
      sources: Array.isArray(note.sources)
        ? note.sources.map((source) => ({
            ...source,
            id: createEntityId('source'),
          }))
        : [],
      tags: Array.isArray(note.tags) ? [...note.tags] : [],
    })),
  }
}

function createEntityId(prefix) {
  return `${prefix}-${randomUUID()}`
}
