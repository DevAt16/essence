# Essence

Essence is a minimalist, writing-first note-taking app built for calm focus, structured thinking, and elegant personal knowledge work.

Tagline: `A lucid space for thought.`

## What It Is

Essence is designed as a quieter alternative to heavier workspace tools. It favors clarity, writing flow, and low cognitive load over dense dashboards and setup-heavy workflows.

Current product foundations:

- editorial library and collections views
- rich block editor
- deep folder nesting
- tags, favorites, and archive flows
- note links, backlinks, and read mode
- undo/redo and quick switcher
- breadcrumbs and folder management
- local-first caching with PostgreSQL sync

## Project Structure

```txt
apps/
  web/   React, TypeScript, Vite, TipTap editor, and app styling
  api/   Node.js, Express, PostgreSQL, auth/session, sync, and AI endpoints
```

Shared package extraction can come later once API contracts and client types need a dedicated home.

## Development

```bash
npm install
copy .env.example .env
npm run db:migrate
npm run db:seed
npm run dev:full
```

Run each side independently:

```bash
npm run dev:web
npm run dev:api
```

Frontend-only development still works with:

```bash
npm run dev
```

Build the web app:

```bash
npm run build
```

The Vite production build writes to `dist/web`.

Run the local Production Gate 1 checks:

```bash
npm run check
```

This runs lint, API auth tests, and the production web build. Supabase dashboard settings still need to be verified separately before a real deployment.

## PostgreSQL

Essence syncs app state through a small Node API backed by PostgreSQL.

- `apps/api/index.mjs` runs the local API
- `apps/api/schema.sql` defines the normalized storage schema
- `apps/api/migrate.mjs` initializes the schema
- `apps/api/seed.mjs` loads seed libraries into PostgreSQL
- the React app hydrates from `/api/state` and falls back to browser `localStorage` if the API is unavailable

Current backend model:

- normalized tables for `workspace_state`, `folders`, `notes`, `note_blocks`, `note_tags`, and `note_links`
- `note_revisions` as the foundation for note history/version restore
- legacy `app_state` kept in sync as a compatibility backup snapshot
- signed-in account sessions are required for sync, search, note history, and AI endpoints
- local-only mode stays in browser `localStorage` and does not receive remote API capabilities

## Authentication

Production auth is designed around invite-only Supabase Auth magic links. Configure both the browser and API with the same Supabase project:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` let the React app receive Supabase sessions after the email link is opened.
- `SUPABASE_URL` lets the API verify Supabase access-token JWTs with the project's JWKS endpoint.
- `SUPABASE_PUBLISHABLE_KEY` lets the API request approved sign-in emails after checking `approved_users`.
- `SUPABASE_JWT_AUDIENCE` defaults to `authenticated`.
- `AUTH_ALLOWED_REDIRECT_ORIGINS` restricts where API-requested auth links may redirect.
- `VITE_WAITLIST_URL` optionally adds a waitlist link to the sign-in screen.
- Approved users live in the `approved_users` table, so waitlist approvals do not require app restarts.

For invite-only operation, disable public signups in Supabase Auth and add or invite approved users from your waitlist. The app also asks Supabase not to create users during OTP sign-in, so unknown emails should not receive a usable sign-in flow. After adding the user in Supabase, approve the same email in Essence:

```bash
npm run auth:approve -- user@example.com
npm run auth:list
npm run auth:revoke -- user@example.com
```

If you want the approval command to also send the Supabase invite email, set the server-only `SUPABASE_SERVICE_ROLE_KEY` and run:

```bash
npm run auth:approve -- user@example.com --invite
```

The older `/api/auth/login` email-only flow is now a development helper. It requires both `AUTH_DEV_EMAIL_LOGIN=true` on the API and `VITE_AUTH_DEV_EMAIL_LOGIN=true` in the browser build. Keep both off for production deployments.

Environment variables:

- `DATABASE_URL`
- `DATABASE_SSL`
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_AUDIENCE`
- `AUTH_INVITE_REDIRECT_URL`
- `AUTH_ALLOWED_REDIRECT_ORIGINS`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_AUTH_DEV_EMAIL_LOGIN`
- `VITE_WAITLIST_URL`
- `AUTH_COOKIE_NAME`
- `AUTH_SESSION_DAYS`
- `AUTH_COOKIE_SECURE`
- `AUTH_DEV_EMAIL_LOGIN` enables the API side of the old email-only development login. Leave it off in production.
- `AUTH_RATE_LIMIT_MAX`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AI_RATE_LIMIT_MAX`
- `AI_RATE_LIMIT_WINDOW_MS`
- `TRUST_PROXY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

Current API endpoints:

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/state`
- `PUT /api/state`
- `GET /api/notes/:noteId/revisions`
- `GET /api/search`
- `POST /api/ai/draft`
- `POST /api/ai/assist`

## Project Notes

The app is built with React, TypeScript, and Vite on the client, plus a Node/Express PostgreSQL sync service. Styling lives primarily in `apps/web/src/App.css` and `apps/web/src/index.css`, with the main application logic in `apps/web/src/App.tsx`.

For product positioning, roadmap, and messaging, see [PRODUCT.md](PRODUCT.md).

For the visual language, interaction principles, and the Material-vs-editorial design stance, see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
