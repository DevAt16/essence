# Production QA

Use this checklist after each production deploy or auth/configuration change.

## Before Deploy

- Run `npm run check`.
- Confirm `.env.example` still matches required runtime variables.
- Confirm production env values are rotated/current without pasting secrets into logs or tickets.
- Confirm Supabase public signups are disabled for invite-only operation.
- Confirm the approved user list includes the smoke-test account.

## Deployment Smoke

- Open the deployed web app on desktop and mobile.
- Confirm local-only entry loads the library.
- Sign in with an approved email code.
- Confirm an unapproved email cannot request access.
- Create a note, edit it, reload, and confirm it persists.
- Open read mode and edit mode for the same note.
- Open settings and confirm profile, appearance, and sign-out controls.
- Open Composer as an approved user.
- Sign out and confirm Composer returns to the locked state.
- Run `npm run smoke:prod` against the production API when `SMOKE_BASE_URL` is configured.

## Mobile Pass

- Verify the bottom navigation does not cover content.
- Verify settings and confirmation dialogs appear above the bottom navigation.
- Verify library search, filters, cards/list toggle, and note actions are tappable.
- Verify editor read mode, edit mode, overflow menu, and toolbar fit on a phone viewport.
- Verify auth code entry and local-only entry fit without horizontal scroll.

## Rollback Triggers

- Approved users cannot sign in.
- Local-only mode cannot create or edit notes.
- Sync overwrites or loses note content.
- Mobile navigation blocks primary actions.
- Production API health or readiness checks fail.
