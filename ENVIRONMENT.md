# Essence Environment Reference

This file explains every field in `.env.example`, what it controls, and whether it is safe to expose to the browser.

## Safety Rules

- `.env` is local/private and must not be committed.
- Variables beginning with `VITE_` are bundled into the web app and are visible in the browser.
- Never create `VITE_` versions of secrets such as `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `GEMINI_API_KEY`.
- Restart the API and Vite dev server after changing `.env`.
- For single-service production hosting, keep `VITE_API_BASE_URL` empty so the browser uses same-origin `/api`.

## Database

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `DATABASE_URL` | API | Yes | PostgreSQL connection string used by the API, migrations, auth approval commands, state sync, search, and note revisions. |
| `RESTORE_DATABASE_URL` | CLI | Yes | Target database for `npm run db:restore`. Kept separate so restores do not accidentally overwrite `DATABASE_URL`. |
| `DATABASE_SSL` | API/CLI | No | Set `true` when the database provider requires SSL, common for managed production PostgreSQL. |

## Runtime

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `NODE_ENV` | API | No | Runtime mode. Use `development` locally and `production` in deployment. Production enables stricter config validation. |
| `PORT` | API | No | Port the Express API listens on. Defaults to `4000` when unset. |
| `SERVE_WEB` | API | No | When `true`, the API serves the built React app from `dist/web`. Use this for single-service hosting. |
| `TRUST_PROXY` | API | No | Set `true` when deployed behind a proxy/load balancer so Express can trust proxy headers. |

## Logging

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `LOG_LEVEL` | API | No | Controls structured API logs. Use `info`, `error`, or `silent`. |
| `REQUEST_LOGGING` | API | No | Set `false` to disable normal request logs while keeping explicit error logs unless `LOG_LEVEL=silent`. |

## Security And CORS

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | API | No | Comma-separated browser origins allowed to call the API. In production, set this to the deployed web app origin. |
| `CORS_ALLOW_CREDENTIALS` | API | No | Controls `Access-Control-Allow-Credentials`. Use `true` for cookie flows, `false` for split bearer-token deployments. |
| `CORS_MAX_AGE_SECONDS` | API | No | How long browsers may cache successful CORS preflight responses. |
| `SECURITY_CSP` | API | No | Enables the API Content Security Policy header unless set to `false`. |
| `SECURITY_HSTS` | API | No | Enables HSTS in production unless set to `false`. Use `true` only when served over HTTPS. |

## Smoke Tests

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `SMOKE_BASE_URL` | CLI | No | Base URL used by `npm run smoke:prod`, usually the deployed API/app URL. |
| `SMOKE_ORIGIN` | CLI | No | Origin used by the smoke test for CORS preflight checks. |

## Supabase Auth

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `SUPABASE_URL` | API | No | Supabase project URL used by the API for JWT verification and OTP email requests. |
| `SUPABASE_PUBLISHABLE_KEY` | API | No | Supabase publishable key used by the API to request and verify OTP emails after checking `approved_users`. Public-safe by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | API/CLI | Yes | Service role key used by approval tooling when it needs elevated Supabase actions. Never expose to the browser. |
| `SUPABASE_JWT_AUDIENCE` | API | No | Expected Supabase JWT audience. Usually `authenticated`. |

Configure the Supabase email OTP template to show the code token, for example `{{ .Token }}`, so users can complete the primary code sign-in flow.

## Auth And Invite Gate

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `AUTH_INVITE_REDIRECT_URL` | API | No | URL where Supabase magic-link fallback emails should return users after login. Use the deployed app URL in production. |
| `AUTH_ALLOWED_REDIRECT_ORIGINS` | API | No | Comma-separated origins allowed for auth redirects. Prevents login links from redirecting to untrusted origins. |
| `AUTH_COOKIE_NAME` | API | No | Cookie name for API-created sessions used by the development email-login helper. |
| `AUTH_SESSION_DAYS` | API | No | Number of days development helper sessions remain valid. |
| `AUTH_COOKIE_SECURE` | API | No | Set `true` in production so session cookies require HTTPS. |
| `AUTH_DEV_EMAIL_LOGIN` | API | No | Enables old API email-only development login. Keep `false` in production. |
| `AUTH_RATE_LIMIT_MAX` | API | No | Maximum auth-link/login attempts per rate-limit window. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | API | No | Auth rate-limit window in milliseconds. |

## Web Build

These values are public because Vite embeds `VITE_*` variables into browser JavaScript.

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Web | No | Supabase project URL used by the browser to receive and persist Supabase sessions. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Web | No | Supabase publishable key used by the browser client. Public-safe by design. |
| `VITE_API_BASE_URL` | Web | No | API origin for split hosting. Leave empty for same-origin `/api` in single-service hosting. |
| `VITE_API_CREDENTIALS` | Web | No | Fetch credentials mode. Use `same-origin` locally/single-service; use `omit` for split Supabase bearer-token deployments. |
| `VITE_AUTH_DEV_EMAIL_LOGIN` | Web | No | Enables the old browser-side development login helper only when the API helper is also enabled. Keep `false` in production. |
| `VITE_WAITLIST_URL` | Web | No | Optional waitlist URL shown on the sign-in page. |
| `VITE_AI_ALLOW_LOCAL_USER` | Web | No | Unlocks Composer controls for the local browser workspace. Set this only when the API also has `AI_ALLOW_LOCAL_USER=true`. |

## Desktop Preview

The internal desktop app is a Tauri shell around the same Vite/React UI.

- `npm run dev:desktop` starts Tauri and the Vite dev server on `http://localhost:5173`.
- `npm run build:desktop` builds the web app and then asks Tauri to create native desktop artifacts.
- Native desktop builds require Rust via rustup and Visual Studio Build Tools with MSVC plus the Windows SDK.
- Desktop local-only notes are stored in the desktop webview profile, separate from browser `localStorage`.
- Composer, sync, and signed-in features still use the same API and Supabase environment values listed above.

## AI Composer

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `AI_ENABLED` | API | No | Set `false` to disable Composer API calls without disabling manual notes or account login. Useful as a cost-control kill switch. |
| `AI_PROVIDER` | API | No | Composer provider. Use `gemini`, `ollama`, `gemini-cli`, or `codex-cli`. Defaults to `gemini`. |
| `AI_ALLOW_LOCAL_USER` | API | No | Allows the local fallback user to call Composer without account sign-in. Use only for private local deployments. |
| `AI_RATE_LIMIT_MAX` | API | No | Maximum AI requests per IP/user per rate-limit window. |
| `AI_RATE_LIMIT_WINDOW_MS` | API | No | AI rate-limit window in milliseconds. |
| `GEMINI_API_KEY` | API | Yes | Gemini API key used by server-side Composer requests. Never expose to the browser. Required in production when `AI_PROVIDER=gemini` and `AI_ENABLED` is not `false`. |
| `GEMINI_MODEL` | API | No | Gemini model name used by Composer. |
| `GEMINI_CLI_COMMAND` | API | No | Gemini CLI executable used when `AI_PROVIDER=gemini-cli`. Defaults to `gemini`. |
| `GEMINI_CLI_MODEL` | API | No | Optional Gemini CLI model override. Empty uses the CLI default. |
| `GEMINI_CLI_CWD` | API | No | Optional working directory for Gemini CLI calls. Empty uses the API directory. |
| `GEMINI_CLI_TRUST_WORKSPACE` | API | No | Trust the Gemini CLI working directory for headless API calls. Defaults to `true` when Essence launches Gemini CLI. |
| `GEMINI_CLI_TIMEOUT_MS` | API | No | Gemini CLI timeout in milliseconds. |
| `CODEX_CLI_COMMAND` | API | No | Codex CLI executable used when `AI_PROVIDER=codex-cli`. Defaults to `codex`. |
| `CODEX_CLI_MODEL` | API | No | Optional Codex CLI model override, such as `gpt-5.5`. Empty uses the CLI default. |
| `CODEX_CLI_REASONING_EFFORT` | API | No | Optional Codex CLI reasoning effort override. Use `minimal`, `low`, `medium`, or `high`; empty uses the CLI default. |
| `CODEX_CLI_CWD` | API | No | Optional working directory for Codex CLI calls. Empty uses the API directory. |
| `CODEX_CLI_TIMEOUT_MS` | API | No | Codex CLI timeout in milliseconds. |
| `OLLAMA_BASE_URL` | API | No | Local Ollama server URL used when `AI_PROVIDER=ollama`. Defaults to `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | API | No | Ollama model name used by Composer, such as `llama3.1`. |

For private local Composer with Ollama, keep Ollama bound to localhost and set both API and web flags:

```env
AI_ENABLED=true
AI_PROVIDER=ollama
AI_ALLOW_LOCAL_USER=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
VITE_AI_ALLOW_LOCAL_USER=true
```

## Recommended Local Values

```env
NODE_ENV=development
SERVE_WEB=false
AUTH_COOKIE_SECURE=false
AUTH_DEV_EMAIL_LOGIN=false
VITE_AUTH_DEV_EMAIL_LOGIN=false
VITE_API_BASE_URL=
VITE_API_CREDENTIALS=same-origin
AI_ENABLED=true
AI_PROVIDER=gemini
AI_ALLOW_LOCAL_USER=false
VITE_AI_ALLOW_LOCAL_USER=false
```

## Recommended Single-Service Production Values

```env
NODE_ENV=production
SERVE_WEB=true
AUTH_COOKIE_SECURE=true
AUTH_DEV_EMAIL_LOGIN=false
VITE_AUTH_DEV_EMAIL_LOGIN=false
VITE_API_BASE_URL=
VITE_API_CREDENTIALS=same-origin
SECURITY_CSP=true
SECURITY_HSTS=true
AI_ENABLED=true
AI_PROVIDER=gemini
AI_ALLOW_LOCAL_USER=false
VITE_AI_ALLOW_LOCAL_USER=false
```
