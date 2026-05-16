const startupContext = {
  cwd: process.cwd(),
  node: process.version,
  nodeEnv: process.env.NODE_ENV ?? '',
  port: process.env.PORT ?? '',
  serveWeb: process.env.SERVE_WEB ?? '',
}

process.on('uncaughtException', (error) => {
  logFatalStartupError('uncaught_exception', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logFatalStartupError('unhandled_rejection', reason)
  process.exit(1)
})

try {
  console.log(JSON.stringify({ event: 'api_bootstrap_started', ...startupContext }))
  const { startServer } = await import('./index.mjs')
  await startServer()
} catch (error) {
  logFatalStartupError('startup_failed', error)
  process.exit(1)
}

function logFatalStartupError(event, error) {
  const normalizedError = normalizeStartupError(error)
  console.error(
    JSON.stringify({
      event,
      ...startupContext,
      error: normalizedError,
    }),
  )
}

function normalizeStartupError(error) {
  if (error instanceof Error) {
    return {
      message: redactSecrets(error.message),
      name: error.name,
      stack: redactSecrets(error.stack ?? ''),
    }
  }

  return {
    message: redactSecrets(String(error)),
    name: typeof error,
    stack: '',
  }
}

function redactSecrets(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@')
    .replace(/\b(?:DATABASE_URL|RESTORE_DATABASE_URL|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)=\S+/gi, '$1=<redacted>')
}
