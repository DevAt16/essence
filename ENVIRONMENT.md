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
| `SUPABASE_URL` | API | No | Supabase project URL used by the API for JWT verification and magic-link requests. |
| `SUPABASE_PUBLISHABLE_KEY` | API | No | Supabase publishable key used by the API to request magic links after checking `approved_users`. Public-safe by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | API/CLI | Yes | Service role key used by approval tooling when it needs elevated Supabase actions. Never expose to the browser. |
| `SUPABASE_JWT_AUDIENCE` | API | No | Expected Supabase JWT audience. Usually `authenticated`. |

## Auth And Invite Gate

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `AUTH_INVITE_REDIRECT_URL` | API | No | URL where Supabase magic links should return users after login. Use the deployed app URL in production. |
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

## AI Composer

| Field | Scope | Secret | Role |
| --- | --- | --- | --- |
| `AI_ENABLED` | API | No | Set `false` to disable Composer API calls without disabling manual notes or account login. Useful as a cost-control kill switch. |
| `AI_RATE_LIMIT_MAX` | API | No | Maximum AI requests per IP/user per rate-limit window. |
| `AI_RATE_LIMIT_WINDOW_MS` | API | No | AI rate-limit window in milliseconds. |
| `GEMINI_API_KEY` | API | Yes | Gemini API key used by server-side Composer requests. Never expose to the browser. Required in production when `AI_ENABLED` is not `false`. |
| `GEMINI_MODEL` | API | No | Gemini model name used by Composer. |

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
```
