# Tripbook: agent context

Family vacation journal PWA. One Next.js 14 (App Router, standalone) app +
Postgres 16 + Caddy in docker compose on a single Lightsail instance.
Media in S3 (originals/ + previews/), email via SES, AI via Anthropic
(OpenRouter opt-in per user). Domain: tripbook.pfeif.us.

## Non-negotiable guardrails
- NEVER set LLM_MOCK in anything that ships. It exists only for tests.
- Migrations are ADDITIVE ONLY: db/schema.sql is applied in full on every
  container start (db/migrate.mjs). Every statement must be idempotent
  (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD). Never DROP TABLE,
  never DROP COLUMN, never rewrite data in schema.sql. Data lives in the
  compose named volume `dbdata`; nothing in a deploy may touch it.
- Permission model (enforce SERVER-SIDE in every new route):
  roles per trip: owner > admin > member > viewer.
  viewer = read timeline/gallery + download originals ONLY; 403 on all
  writes and on every book/draft/export endpoint.
  Site admins (ADMIN_EMAILS env) moderate everything, incl. non-member.
  Helpers: requireMember, canContribute, canModerate, isSiteAdmin (lib/auth).
- Every mutation that changes what other members see must call
  emitTrip(tripId) (lib/events.js) so SSE clients update live.
- Book pipeline: photos only (kind='photo'); videos never enter drafts,
  corpus, scoring, or validation.
- All AI calls go through lib/llm.js complete(); prompts assemble via
  lib/prompts.js (locked scaffold + user steering blocks). Parse model
  JSON with parseModelJson (lib/book.js), never raw JSON.parse.
- iOS Safari is the primary client: no Background Sync, no push, EXIF GPS
  stripped by the picker. See docs/ARCHITECTURE.md before touching
  capture/offline code.

## Commands
- Build: `npm run build` (must pass before any PR)
- Migrate: `DATABASE_URL=... node db/migrate.mjs` (idempotent; CI applies twice)
- Local test pattern: LLM_MOCK=1 + fake AWS creds; see git history smoke tests
- Deploy: merge to main -> .github/workflows/deploy.yml -> deploy/deploy.sh
  (pre-deploy pg_dump to S3, pull, rebuild, /api/health gate)

## Layout
- app/api/** route handlers; app/** pages; components/** client components
- lib/: auth, db, s3, ses, geocode, llm, prompts, specops (layout-spec ops
  + validation), book (generation/edit/scoring), events (SSE), outbox
  (client offline queue), exifClient (client EXIF/MP4 parsing), crypto
- db/schema.sql single source of schema truth
- docs/: ARCHITECTURE, RUNBOOK (deploy), SPEC-* (feature specs w/ decisions)

## Conventions
- Specs first for nontrivial features: docs/SPEC-<name>.md with numbered
  locked decisions, then implement, then update RUNBOOK Phase 8 acceptance.
- User-facing errors are plain sentences, not codes.
- Design tokens in app/globals.css (--ink/--paper/--tide/--tag); luggage-tag
  day dividers are the visual signature. No new CSS frameworks.
