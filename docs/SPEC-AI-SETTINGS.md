# Spec: AI Settings, Model Routing, and Best-Picture Selection

Adds an owner-only Settings page that controls which model does which job,
exposes the steering prompts for editing, and turns on vision-based photo
curation ("best pictures") when a vision-capable model is configured. Builds
on SPEC-BOOK-EDITOR.md; the apply_edits pipeline and draft model are
unchanged.

## Decisions (locked)

- D1: **Provider abstraction with two backends: Anthropic direct (default)
  and OpenRouter.** All AI calls go through one internal `llm.complete(task,
  messages, tools?)` interface. Anthropic direct stays the zero-config path
  using ANTHROPIC_API_KEY from env; OpenRouter is opt-in via a key entered in
  Settings. Rationale: OpenRouter gives model choice with one key and an
  OpenAI-compatible API, but the app must not break if it is never configured.
- D2: **Per-task routing, four tasks.** Each task maps to a provider+model:
  1. `narrative` - full book generation and chapter/book-scope AI edits
  2. `page_edit` - page-scope edits, captions, text polish
  3. `vision_curation` - photo scoring and duplicate grouping (image input)
  4. `transcribe_polish` - cleaning up dictated/rough journal text on save
     (off by default; opt-in toggle, because silently rewriting a family
     member's words conflicts with curated mode's promise)
  Tasks 1 and 2 are text-only; task 3 requires a model with image input,
  and the UI enforces that.
- D3: **App-level settings, owner = any trip owner is too broad; settings
  are per-user and apply to actions that user triggers.** In practice this
  is one user (David) tuning his own book generations. Stored in a new
  `user_settings` table, not env, so tuning never requires a redeploy.
- D4: **The OpenRouter key is stored encrypted at rest** with AES-256-GCM
  using a key derived from a new required env var `SETTINGS_SECRET`
  (openssl rand -hex 32; added to .env.example and the runbook). It is never
  returned to the client after save; the UI shows only `sk-or-...last4` and
  a Replace button. Rationale: DB dumps go to S3 nightly; a plaintext key in
  a backup is an avoidable leak.
- D5: **Prompts are split into a locked scaffold and editable steering
  blocks.** The output contract (JSON shape, apply_edits tool schema, photoId
  validity rules, curated-mode "family's own words only" rule) is code-owned
  and not editable. What IS editable, per task: voice/tone instructions,
  curation philosophy, pacing targets, caption style, chapter conventions.
  Rationale: full prompt override lets one edit break JSON parsing or the
  photoId guardrails; the steering blocks are where all the creative tuning
  lives anyway. The Settings page shows the full assembled prompt read-only
  (scaffold rendered dimmed, steering blocks highlighted) so nothing is
  hidden, with edit boxes for the steering blocks.
- D6: **Prompt edits are versioned like draft revisions**: every save
  snapshots to `prompt_revisions`, with one-tap Reset to default. Defaults
  live in code (`lib/prompts.js`) so a git pull can improve defaults without
  touching user overrides.
- D7: **Best-picture selection is a generation-time scoring pass, cached per
  photo.** When enabled, each ready photo gets one vision call (on its
  1600px preview) producing `quality` (0-100), `tags` (few words: people,
  landscape, food, blurry, duplicate-ish), and the server computes
  `dup_group` by clustering same-author photos within a 3-minute window at
  the same place whose vision descriptions match. Scores persist on the
  photos table; a photo is scored once, not per generation. Rationale: cost
  scales with photos, not with regenerations, and the editor tray can show
  the scores permanently.
- D8: **Curation strength is a user-facing dial, not a prompt hack.**
  Setting: `Everything (no curation) / Balanced / Highlights only`, which the
  corpus builder translates into concrete instructions (target page counts
  and a minimum quality percentile when scores exist). This is the "tune the
  creation" knob that does not require touching prompts at all.
- D9: OpenRouter calls that need tool use (apply_edits) require a model with
  function-calling support. The model picker filters OpenRouter's catalog to
  tool-capable models for tasks 1 and 2, image-capable for task 3. Catalog
  fetched from OpenRouter's /models endpoint server-side and cached 24h.
- D10: **Fallback chain**: if a task's configured provider call fails
  (auth, model retired, rate limit), the call retries once, then falls back
  to Anthropic direct with the default model, and the response surfaces a
  notice ("generated with fallback model"). Book generation should degrade,
  not die, when an experiment misfires.

## Schema

```sql
CREATE TABLE user_settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  openrouter_key_enc BYTEA,               -- AES-256-GCM (nonce || ciphertext || tag)
  openrouter_key_last4 TEXT,
  routing JSONB NOT NULL DEFAULT '{}',    -- { narrative: {provider, model}, page_edit: {...}, vision_curation: {...}, transcribe_polish: {...} }
  curation_level TEXT NOT NULL DEFAULT 'balanced'
    CHECK (curation_level IN ('everything','balanced','highlights')),
  best_pictures_enabled BOOLEAN NOT NULL DEFAULT false,
  transcribe_polish_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prompt_overrides (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,                     -- narrative | page_edit | vision_curation | transcribe_polish
  block TEXT NOT NULL,                    -- steering block id, e.g. 'voice', 'curation', 'captions'
  content TEXT NOT NULL,
  PRIMARY KEY (user_id, task, block)
);

CREATE TABLE prompt_revisions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  task TEXT NOT NULL, block TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE photos ADD COLUMN quality INT;          -- 0-100, null = unscored
ALTER TABLE photos ADD COLUMN vision_tags TEXT[];
ALTER TABLE photos ADD COLUMN dup_group TEXT;       -- null or group id
```

## Prompt architecture (lib/prompts.js)

Each task's prompt assembles as:

```
[SCAFFOLD: role + output contract + hard rules]     <- code-owned, locked
[STEERING BLOCK: voice]                              <- editable
[STEERING BLOCK: curation]                           <- editable
[STEERING BLOCK: captions]                           <- editable (narrative/page_edit)
[SCAFFOLD: corpus injection + final format reminder] <- code-owned, locked
```

Default steering blocks ship in code. Examples of what editing enables
without touching the contract: "write like a postcard, first person plural,
never exceed two sentences of narrative per chapter"; "prefer photos with
people in them over scenery"; "captions should sound like Dad's dry humor."

Curated mode note: the family's-own-words rule is scaffold, so no steering
edit can un-lock it. If a steering block contradicts scaffold, scaffold wins
by construction (it brackets the steering text and restates the contract
last).

## Best pictures pipeline

1. Toggle on in Settings (requires a vision-capable model routed to
   `vision_curation`; Anthropic default qualifies).
2. Backfill job scores all unscored ready photos for the user's trips:
   batched, N at a time, resumable, progress shown in Settings
   ("142 of 203 photos scored"). New photos score on upload completion.
3. Scoring call input: the 1600px preview image + timestamp/place/author.
   Output (JSON): `{ quality, tags, description }`. `description` (one
   sentence) is stored transiently to compute dup_group, then discarded.
4. Corpus builder additions when scores exist: each photo entry gains
   `quality`, `tags`, `dupGroup`. Generation and AI-curate instructions gain:
   use at most one photo per dupGroup unless quality within the group is
   uniformly high and the moment differs; honor the curation_level targets.
5. Editor tray surfaces it: sort by quality, a "duplicates" filter that
   stacks dup groups, and a one-tap "keep best of each group."

Cost note (surfaced in the Settings UI): scoring ~200 photos with a vision
model is a one-time cost on the order of a dollar or two depending on model;
the UI shows the count before starting the backfill.

## Settings page (route: /settings, linked from the trips screen)

Sections, top to bottom:

1. **Models**
   - Provider status card: Anthropic (from server env, always available),
     OpenRouter (key field, Test button that lists 3 models from the catalog
     as proof of life, last4 display after save).
   - Four task rows, each: task name, plain-language description, provider
     select, model select (filtered per D9), "reset to default."
2. **Creation tuning**
   - Curation level (three-way choice with plain descriptions).
   - Best pictures toggle + scoring progress + estimated cost before backfill.
   - Transcribe polish toggle with an explicit "rewrites are visible as
     edits, original text is kept" note.
3. **Prompts**
   - One expandable panel per task showing the assembled prompt: scaffold
     dimmed and locked, steering blocks as editable text areas with
     per-block Reset and a revision history drawer.
4. **Danger zone**
   - Remove OpenRouter key. Clear all photo scores.

## API surface

```
GET    /api/settings
PUT    /api/settings                       -> routing, toggles, curation level
PUT    /api/settings/openrouter-key        -> { key } (validated with a live /models call before saving)
DELETE /api/settings/openrouter-key
GET    /api/settings/models?task=          -> filtered catalog for pickers
GET    /api/settings/prompts               -> assembled prompts + override state
PUT    /api/settings/prompts/:task/:block
POST   /api/settings/prompts/:task/:block/reset
POST   /api/settings/score-photos          -> start/resume backfill; GET same path for progress
```

## lib/llm.js (replaces direct Anthropic calls in book.js)

```
complete(userId, task, { system, messages, tools?, expectJson? })
  -> resolves routing from user_settings (default: anthropic + per-task default model)
  -> anthropic backend: existing SDK path
  -> openrouter backend: POST https://openrouter.ai/api/v1/chat/completions
     (OpenAI format; tools mapped to OpenAI function-calling; decrypted key)
  -> on failure: retry once, then fallback per D10, tagging the result
```

Default models (code constants, overridable per task): narrative and
page_edit `claude-sonnet-4-6`, vision_curation `claude-haiku-4-5` (cheap,
image-capable, scoring does not need heavyweight reasoning),
transcribe_polish `claude-haiku-4-5`.

## Out of scope

- Per-trip (rather than per-user) model settings.
- Streaming token display in the editor.
- Local models / arbitrary OpenAI-compatible base URLs (OpenRouter already
  covers the aggregator case; a custom base URL field is a trivial v2 add if
  wanted).
- Editing the scaffold. If a scaffold change is genuinely needed, that is a
  code change with a PR, on purpose.

## Build estimate

| Piece | Size |
|---|---|
| user_settings + key encryption + settings API | S-M |
| lib/llm.js provider abstraction + OpenRouter tools mapping + fallback | M |
| Settings UI (models, tuning, prompts panels) | M |
| Prompt block assembly + overrides + revisions | S-M |
| Vision scoring pipeline + backfill job + tray integration | M |
| Corpus/prompt updates for quality, dupGroup, curation levels | S |

Roughly one focused week, parallel to nothing else. The OpenRouter
tool-calling mapping and the dup-group clustering are the two spots most
likely to eat unplanned hours.
