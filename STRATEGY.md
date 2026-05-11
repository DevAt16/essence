# Essence Strategy Plan

Last reviewed: 2026-05-11

This document captures the current product, desktop, production, and revenue direction for Essence. It should guide sequencing decisions without replacing the tactical deployment checklist in [DEPLOYMENT.md](DEPLOYMENT.md) or the product positioning in [PRODUCT.md](PRODUCT.md).

## Strategic Thesis

Essence should remain one shared web app core, but its strongest long-term posture is desktop-first.

The browser app is still valuable for onboarding, trials, account access, shared links, and fast iteration. The desktop app should become the flagship experience because Essence is built around long writing sessions, research, reading, local ownership, import/export, keyboard flow, and low-distraction thinking.

The product should be framed as:

`A calm desktop writing workspace, also available on the web.`

## Current State

The codebase is a React/Vite frontend with a Node/Express API, PostgreSQL sync, Supabase invite auth, and server-side Gemini Composer endpoints.

Current production posture:

- local verification passes with lint, API tests, and production build
- Gate 2 implementation is mostly in place
- deployment proof is still pending
- local-only mode uses browser `localStorage`
- signed-in mode relies on the hosted API for sync, search, note history, auth, and AI

Current strategic implication:

- do not rewrite the product as native-only
- do not bundle server secrets or PostgreSQL directly into a desktop app
- package the existing frontend for desktop and keep the backend hosted

## Production Gate 2

Gate 2 should be finished before serious desktop investment. The desktop client will depend on the same hosted backend, auth, logging, and backup posture as the browser app.

Code-ready items:

- `/api/health` and `/api/ready`
- strict production config checks
- invite-only auth gate
- PostgreSQL normalized sync schema
- note revision storage foundation
- production smoke-test script
- backup, verify, and restore commands
- production build path with optional `SERVE_WEB=true`

Pending validation:

- deploy API with real production environment values
- deploy web, or run single-service hosting with `SERVE_WEB=true`
- run `npm run smoke:prod` against deployed URLs
- approve a real test user
- receive and open a Supabase magic link
- create and edit a note, refresh, and confirm sync
- confirm Composer is unavailable in local-only mode
- confirm Composer is available only after invite sign-in
- revoke the test user and confirm access is blocked
- confirm a fresh unapproved email cannot receive a usable sign-in flow
- enable managed daily PostgreSQL backups
- restore a backup into a disposable database
- run migrations against the restored database
- start the API against the restored database and confirm `/api/ready`
- confirm JSON request and error logs are visible in hosting logs
- verify Supabase dashboard settings, including disabled public signup and correct redirect URLs

Gate 2 exit condition:

Essence can be trusted as a hosted app with auth, sync, backups, observability, and recovery tested once end to end.

## Desktop Plan

Desktop work should begin immediately after Gate 2 deployment validation, starting with a small Tauri spike.

### Desktop Spike

Goal: prove the existing app can run as a Windows/macOS shell without changing the product architecture.

Scope:

- add Tauri scaffolding
- package the existing Vite app
- point the desktop build at the hosted API through `VITE_API_BASE_URL`
- verify app boot, auth, sync, search, note history, and Composer
- identify auth redirect requirements for Supabase magic links
- confirm secrets remain server-only

Success criteria:

- desktop app opens to the real Essence UI
- signed-in user can sync notes through the hosted API
- local-only user can still write without Composer
- Composer works only for signed-in approved users
- no server secrets are bundled into the client

### Desktop v1

Desktop v1 should be an online-syncing native wrapper, not a full local database rewrite.

Likely scope:

- Windows and macOS builds
- app icon and native window metadata
- hosted API configuration
- auth redirect/deep-link handling, such as `essence://auth/callback`
- native menu basics
- stable import/export from the desktop shell
- crash/error reporting decision
- update strategy decision
- signing and notarization plan

Desktop v1 should not include:

- embedded PostgreSQL
- bundled Gemini or Supabase service keys
- full offline sync conflict resolution
- team collaboration
- enterprise administration

### Desktop v1.5+

After the wrapper proves valuable, add true desktop advantages:

- stronger local store with SQLite or IndexedDB
- offline-first editing with background sync
- file-system import/export workflows
- native PDF and Markdown handling
- global shortcuts and quick capture
- native menus and command palette polish
- automatic updates
- signed installers
- encrypted local storage
- more explicit sync activity and recovery UI

## Revenue Plan

Essence can generate revenue if it is sold as a trusted writing and research environment, not as a generic notes app.

The strongest monetization promise is:

Users pay so their thinking space is safe, synced, recoverable, calm, and useful over time.

Recommended model:

### Free

Purpose: remove adoption friction and prove the writing experience.

Included:

- local-only notes
- manual writing and reading mode
- basic folders, tags, backlinks, and library
- Markdown import
- Markdown/JSON export
- no Composer
- no cloud sync
- no hosted search
- no note history UI beyond local state

### Essence Pro

Suggested price:

- `$8-$12/month`
- `$80-$100/year`

Included:

- cloud sync
- desktop app access
- hosted search
- note history and restore
- AI Composer and Assist
- larger imports
- reliable backups
- priority support for early users

Pricing principle:

Charge for continuity, sync, recovery, and calm focus. AI should strengthen Pro, but the plan should not depend only on AI usage.

### Founding Plan

Suggested early offer:

- `$49-$99/year`
- limited seats or limited time

Purpose:

- validate willingness to pay
- fund hosting and AI usage
- recruit high-signal early users
- create a small feedback group before broader launch

Founding users should receive:

- Pro access during the founding period
- desktop beta access
- a clear export guarantee
- visible influence on the roadmap

### Later Plans

Possible later plans:

- student discount
- researcher/writer annual plan
- small lab or cohort plan
- team plan only after individual workflows are excellent

Avoid enterprise sales until the core writing, sync, search, import/export, and desktop workflows are polished.

## Sequencing

Recommended order:

1. Finish Gate 2 deployment validation.
2. Add a simple entitlement model for Free versus Pro.
3. Run a small paid founding-user test.
4. Start a Tauri desktop spike.
5. Ship desktop v1 to founding users.
6. Add desktop-native advantages only after the wrapper is proven useful.

Do not start with a hard browser-to-desktop pivot. Keep one product core and let desktop become the flagship distribution channel.

## Near-Term Decisions

Open decisions before desktop v1:

- Tauri auth redirect shape
- whether desktop access is Pro-only or available to all signed-in users during beta
- whether Pro includes metered AI usage or a generous fair-use limit
- whether local-only users can use desktop without an account
- how to handle sync conflict messaging before true offline-first support
- what backup retention promise Pro users receive
- whether founding users get price lock-in

## Product Guardrails

Essence should continue to avoid:

- broad workspace-operating-system features
- complex databases as the primary metaphor
- team collaboration before individual depth
- AI features that create unverified citations or false authority
- lock-in without export
- pricing that makes users feel punished for thinking slowly

Essence should keep investing in:

- writing flow
- reliable autosave
- search
- version history
- Markdown and JSON portability
- calm reading mode
- note links and backlinks
- desktop-quality keyboard navigation
- trustworthy sync and recovery
