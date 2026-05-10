# Essence Deployment

This is the Production Gate 2 deployment baseline. Gate 1 proves invite-only auth works; Gate 2 makes the app easier to run, observe, and recover.

## Deployment Shape

Recommended production split:

- Web: static host such as Vercel, Netlify, Cloudflare Pages, or an object/CDN host.
- API: Node host such as Render, Fly, Railway, or a VPS.
- Database: managed PostgreSQL such as Supabase, Neon, Render, or RDS.

Single-service deployment is also supported. Build the web app and run the API with `SERVE_WEB=true`; the API will serve `dist/web` and keep SPA routing working.

```bash
npm install
npm run build
npm run db:migrate
NODE_ENV=production SERVE_WEB=true npm start
```

## Runtime Commands

```bash
npm run build
npm run db:migrate
npm start
npm run check
```

`npm start` runs the production API entrypoint. `npm run check` runs lint, API tests, and the production web build.

## Required Production Environment

Set these on the API host:

- `NODE_ENV=production`
- `DATABASE_URL`
- `DATABASE_SSL=true` when required by the database provider
- `PORT`
- `CORS_ALLOWED_ORIGINS=https://your-app-domain`
- `CORS_ALLOW_CREDENTIALS=true` if browser cookies must cross origins; otherwise `false` is fine for Supabase bearer-token auth
- `SECURITY_CSP=true`
- `SECURITY_HSTS=true` when the API is served over HTTPS
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only if approval commands need to send invites from that environment
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_DEV_EMAIL_LOGIN=false`
- `AUTH_INVITE_REDIRECT_URL=https://your-app-domain`
- `AUTH_ALLOWED_REDIRECT_ORIGINS=https://your-app-domain`
- `TRUST_PROXY=true` when the API runs behind a proxy/load balancer
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

Set these on the web build host:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL=https://your-api-domain` when the frontend and API are hosted separately. Leave it empty for same-origin `/api`.
- `VITE_API_CREDENTIALS=omit` for split Supabase-token deployments, or `include` only when cross-origin cookies are intentionally required.
- `VITE_AUTH_DEV_EMAIL_LOGIN=false`
- `VITE_WAITLIST_URL` if the sign-in screen should link to the waitlist

The API refuses to start in production when critical auth settings are missing, localhost redirects are configured, or secure cookies are off.

## Security Headers And CORS

The API sets baseline browser security headers:

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Strict-Transport-Security` in production when `SECURITY_HSTS` is not `false`

CORS is locked to configured origins. Use `CORS_ALLOWED_ORIGINS` for the deployed frontend origin. The API also considers `AUTH_ALLOWED_REDIRECT_ORIGINS`, `AUTH_INVITE_REDIRECT_URL`, and `APP_URL` as allowed origins.

For split hosting, set both sides:

```bash
# API host
CORS_ALLOWED_ORIGINS=https://your-web-domain

# Web build host
VITE_API_BASE_URL=https://your-api-domain
VITE_API_CREDENTIALS=omit
```

## Health Checks

- `GET /api/health`: liveness check. Does not require the database.
- `GET /api/ready`: readiness check. Verifies the database and reports auth/static-web readiness.

Use `/api/health` for simple uptime checks and `/api/ready` for deployment readiness checks.

## Smoke Test

After deployment, run the automated smoke checks from your workstation:

```bash
SMOKE_BASE_URL=https://your-api-domain SMOKE_ORIGIN=https://your-web-domain npm run smoke:prod
```

The smoke command verifies:

- `/api/health`
- `/api/ready`
- security headers and request IDs
- unauthenticated workspace blocking
- unapproved magic-link blocking
- CORS preflight for `SMOKE_ORIGIN` when provided

Manual smoke checks still required:

- approve a real test email
- receive and open the magic link
- create/edit a note and refresh to confirm sync
- revoke the test email and confirm access is blocked
- confirm a fresh unapproved email cannot receive a usable sign-in flow

## Logging

The API writes JSON logs with request IDs:

- each response includes `X-Request-Id`
- request logs include method, path, status, duration, and request ID
- server errors include request ID and stack traces outside production

Controls:

- `LOG_LEVEL=info` logs normal request events
- `LOG_LEVEL=error` logs only errors
- `LOG_LEVEL=silent` disables API logs
- `REQUEST_LOGGING=false` disables request logs while preserving explicit error logs unless `LOG_LEVEL=silent`

## Backup Baseline

Use managed automatic PostgreSQL backups where available. Essence also includes local wrappers for PostgreSQL client tools:

```bash
npm run db:backup
npm run db:backup -- --out backups/essence-pre-launch.dump
npm run db:backup:verify -- --file backups/essence-pre-launch.dump
```

The backup command writes PostgreSQL custom-format dumps into `backups/` by default. That directory is ignored by git.

Restore only into a fresh test database before trusting the backup process:

```bash
RESTORE_DATABASE_URL=postgresql://... npm run db:restore -- --file backups/essence-pre-launch.dump --yes
```

The restore command refuses to restore into `DATABASE_URL` unless `--allow-source-overwrite` is passed. Keep that override for emergency recovery only.

Before launch, confirm:

- daily automated backups are enabled
- at least one restore has been tested
- backup retention matches your support expectations
- `approved_users`, `users`, notes, revisions, and workspace state are included

Restore proof checklist:

- create a backup with `npm run db:backup`
- verify the dump archive with `npm run db:backup:verify -- --file <dump>`
- restore into a disposable database via `RESTORE_DATABASE_URL`
- run `npm run db:migrate` against the restored database
- start the API pointed at the restored database
- confirm `/api/ready` returns `ok: true`

## Gate 2 Exit Criteria

- production API starts with strict runtime config
- health and readiness checks are wired into hosting
- JSON request/error logs are visible in the host logs
- database backups are configured and restore-tested
- deployed smoke test passes for approve, login, sync, revoke, and unapproved-user blocking
