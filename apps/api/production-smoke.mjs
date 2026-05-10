import 'dotenv/config'

import assert from 'node:assert/strict'

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 4000}`)
const smokeOrigin = normalizeOptionalOrigin(process.env.SMOKE_ORIGIN)
const unapprovedEmail =
  process.env.SMOKE_UNAPPROVED_EMAIL || `smoke-unapproved-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
const checks = []

try {
  await runCheck('health endpoint is live', async () => {
    const response = await request('/api/health')

    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.service, 'essence-api')
    assert.match(response.headers.get('x-request-id') ?? '', /^[a-zA-Z0-9_.:-]{8,128}$/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
  })

  await runCheck('ready endpoint can reach dependencies', async () => {
    const response = await request('/api/ready')

    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.checks.database, 'ok')
  })

  await runCheck('unauthenticated workspace access is blocked', async () => {
    const response = await request('/api/state')

    assert.equal(response.status, 401)
    assert.match(response.body.error, /sign in required/i)
  })

  await runCheck('unapproved email cannot request magic link', async () => {
    const response = await request('/api/auth/request-link', {
      body: {
        email: unapprovedEmail,
        redirectTo: baseUrl,
      },
      method: 'POST',
    })

    assert.equal(response.status, 403)
    assert.match(response.body.error, /not invited/i)
  })

  if (smokeOrigin) {
    await runCheck('CORS preflight accepts configured frontend origin', async () => {
      const response = await rawRequest('/api/state', {
        headers: {
          'Access-Control-Request-Headers': 'Authorization, Content-Type',
          'Access-Control-Request-Method': 'PUT',
          Origin: smokeOrigin,
        },
        method: 'OPTIONS',
      })

      assert.equal(response.status, 204)
      assert.equal(response.headers.get('access-control-allow-origin'), smokeOrigin)
      assert.match(response.headers.get('access-control-allow-methods') ?? '', /PUT/)
    })
  }

  printSummary()
} catch (error) {
  printSummary()
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

async function runCheck(name, callback) {
  const startedAt = Date.now()

  try {
    await callback()
    checks.push({ durationMs: Date.now() - startedAt, name, ok: true })
  } catch (error) {
    checks.push({
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      name,
      ok: false,
    })
    throw error
  }
}

async function request(path, options = {}) {
  const response = await rawRequest(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()

  return {
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
    status: response.status,
  }
}

function rawRequest(path, options = {}) {
  return fetch(new URL(path, baseUrl), options)
}

function normalizeBaseUrl(value) {
  try {
    return new URL(value).toString().replace(/\/+$/g, '')
  } catch {
    throw new Error(`Invalid SMOKE_BASE_URL: ${value}`)
  }
}

function normalizeOptionalOrigin(value) {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).origin
  } catch {
    throw new Error(`Invalid SMOKE_ORIGIN: ${value}`)
  }
}

function printSummary() {
  for (const check of checks) {
    const marker = check.ok ? 'PASS' : 'FAIL'
    const suffix = check.ok ? '' : `: ${check.error}`
    console.log(`${marker} ${check.name} (${check.durationMs}ms)${suffix}`)
  }
}
