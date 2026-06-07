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
src-tauri/
  Tauri desktop shell for internal app-feel testing
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

## Local Composer Providers

For a private personal setup, Composer can use a local provider through the API without requiring an approved remote account.

### Ollama

Keep Ollama on localhost, pull the model you want, and enable the local Composer flags in `.env`:

```bash
ollama pull llama3.1
```

```env
AI_ENABLED=true
AI_PROVIDER=ollama
AI_ALLOW_LOCAL_USER=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
VITE_AI_ALLOW_LOCAL_USER=true
```

### Gemini CLI

If you already use Gemini CLI locally, Composer can call it through the API in headless mode. Install and authenticate Gemini CLI first, then use:

```env
AI_ENABLED=true
AI_PROVIDER=gemini-cli
AI_ALLOW_LOCAL_USER=true
GEMINI_CLI_COMMAND=gemini
GEMINI_CLI_MODEL=
GEMINI_CLI_CWD=
GEMINI_CLI_TRUST_WORKSPACE=true
GEMINI_CLI_TIMEOUT_MS=90000
VITE_AI_ALLOW_LOCAL_USER=true
```

Leave `GEMINI_CLI_MODEL` empty to use the CLI default, or set a model supported by your Gemini CLI setup. `GEMINI_CLI_CWD` is optional; when empty, Essence runs the CLI from the API directory. `GEMINI_CLI_TRUST_WORKSPACE=true` lets headless API calls run without Gemini CLI's interactive trusted-folder prompt.

### Codex CLI

If you use OpenAI Codex CLI locally, Composer can run it in non-interactive mode through the API. Install and authenticate Codex CLI first, then use:

```env
AI_ENABLED=true
AI_PROVIDER=codex-cli
AI_ALLOW_LOCAL_USER=true
CODEX_CLI_COMMAND=codex
CODEX_CLI_MODEL=
CODEX_CLI_REASONING_EFFORT=
CODEX_CLI_CWD=
CODEX_CLI_TIMEOUT_MS=120000
VITE_AI_ALLOW_LOCAL_USER=true
```

Leave `CODEX_CLI_MODEL` empty to use the CLI default, or set a model such as `gpt-5.5`. Set `CODEX_CLI_REASONING_EFFORT` to `minimal`, `low`, `medium`, or `high` when you want Essence to override the Codex CLI default reasoning effort. Composer runs `codex exec` with read-only sandboxing, an output schema, and an ephemeral session.

Then run:

```bash
npm run dev:full
```

Build the web app:

```bash
npm run build
```

The Vite production build writes to `dist/web`.

Run the internal desktop preview:

```bash
npm run dev:desktop
```

Build a local desktop bundle:

```bash
npm run build:desktop
```

Desktop builds require Rust via rustup plus Visual Studio Build Tools with the MSVC and Windows SDK components. The desktop shell uses the same React app but stores local-only notes in the desktop webview profile, separate from the browser profile.

Run the production API:

```bash
npm start
```

Run the local Production Gate 1 checks:

```bash
npm run check
```

This runs lint, API auth tests, and the production web build. Supabase dashboard settings still need to be verified separately before a real deployment.

For production runtime, health checks, logging, backups, and deployment options, see [DEPLOYMENT.md](DEPLOYMENT.md).
For the release smoke checklist, see [docs/production-qa.md](docs/production-qa.md).

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
- signed-in account sessions are required for sync, search, and note history
- AI endpoints require signed-in account sessions unless private local Composer is explicitly enabled
- local-only mode stays in browser `localStorage` and does not receive remote sync/search/history capabilities

## Authentication

Production auth is designed around invite-only Supabase Auth email codes, with magic links kept as a fallback. Configure both the browser and API with the same Supabase project:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` let the React app store Supabase sessions after an email code is verified.
- `SUPABASE_URL` lets the API verify Supabase access-token JWTs with the project's JWKS endpoint.
- `SUPABASE_PUBLISHABLE_KEY` lets the API request and verify approved sign-in emails after checking `approved_users`.
- `SUPABASE_JWT_AUDIENCE` defaults to `authenticated`.
- `AUTH_ALLOWED_REDIRECT_ORIGINS` restricts where API-requested auth links may redirect.
- `VITE_WAITLIST_URL` optionally adds a waitlist link to the sign-in screen.
- Approved users live in the `approved_users` table, so waitlist approvals do not require app restarts.

For invite-only operation, disable public signups in Supabase Auth and add or invite approved users from your waitlist. Configure the Supabase email OTP template to include the token, such as `{{ .Token }}`, so users can enter the code in Essence. The app also asks Supabase not to create users during OTP sign-in, so unknown emails should not receive a usable sign-in flow. After adding the user in Supabase, approve the same email in Essence:

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

Environment variables are documented in [ENVIRONMENT.md](ENVIRONMENT.md). That reference explains each field, whether it is browser-visible, and which values should stay server-only.

Current API endpoints:

- `GET /api/health`
- `GET /api/ready`
- `GET /api/auth/session`
- `POST /api/auth/request-code`
- `POST /api/auth/request-link`
- `POST /api/auth/verify-code`
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

For the current production, desktop, and revenue sequencing plan, see [STRATEGY.md](STRATEGY.md).

For the visual language, interaction principles, and the Material-vs-editorial design stance, see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
