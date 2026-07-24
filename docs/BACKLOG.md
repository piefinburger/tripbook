# Tripbook backlog

Captured after the first real trip (Netherlands, July 2026), which the app
came through successfully: capture, grouping, gallery, viewers, and live
updates all held up with a real family and real viewers back home.

Current goal: **get the book written and printed.** Items are grouped by
whether they block that.

---

## Do these first: they block a good printed book

### 1. Verify the book renders from ORIGINALS, not previews
Status: **VERIFIED** (2026-07-24). `app/book/render/[id]/page.js` selects `s3_key` and calls `presignGet` directly — no derivative tier, no URL cache. Confirmed correct.

The PDF is produced by headless Chromium rendering `/book/render/{id}`.
Check which tier that page's `<img>` srcs resolve to. Previews are 1600px
webp at q78 — fine on screen, visibly soft printed at 8.5in square. The
book must pull `photos.s3_key` (the untouched upload).

Note the interaction with the thumbnail work: `lib/photoUrls.js` caches
`thumb` and `preview` tiers only, deliberately. Originals are signed
per-request and never cached, so the render path should be signing them
directly.

### 2. Verify "Download original" really is the original
Status: **VERIFIED** (2026-07-24). `GET /api/photos/[id]` presigns `p.s3_key` with attachment disposition. Confirmed correct.

`GET /api/photos/[id]` presigns `s3_key` with an attachment
Content-Disposition. Confirm it hasn't drifted to a derivative. Shares a
code path with item 1, so do them together.

### 3. Notes should inherit the date of their attached photos
Status: part bug, part feature. Real usage surfaced this.

Family members wrote notes at the END of the trip and attached photos
taken days earlier. The note got stamped `now()`, and since the timeline
sorts by note timestamp, the photos were dragged to the wrong day. This
also corrupts book chapter ordering, which is built from timestamps.

The fix is half-built already: the GROUP flow (`annotateSelection` in
components/TripView.js) already dates a grouped note from its earliest
photo and inherits that photo's lat/lng. The plain note composer does not.
Apply the same rule when a note is saved with photos attached, unless the
author explicitly overrides.

Also surface each photo's own capture time in the UI, so a note's date and
a photo's date being different is visible rather than confusing.

### 4. Manual date / time / location editing for notes and photos
The escape hatch for whatever item 3 can't infer correctly.

Watch out for: changing a timestamp re-sorts the item and can move it
across a day divider (the timeline groups by day); location edits should
re-run the Nominatim reverse geocode; and both need `emitTrip()` so other
members' views update live.

---

## Not on any list, but it stands between you and a physical book

### Print vendor requirements
The exporter produces 8.5in square pages via Chromium. It was never
designed against a real printer's spec: no bleed, no trim margins, no
spine width, no stated DPI floor. Before publishing, pick a vendor (Blurb,
Lulu, Mixbook, etc.), read their template spec, and adjust
`components/BookPages.js` and the render CSS to match. This is the largest
unknown in the whole book path.

### The book editor has never run on real data
Everything in the editor and generation pipeline was verified with
`LLM_MOCK=1` and a handful of seeded photos. The first generation against
a real trip (48+ photos, real notes, real EXIF) is genuinely untested.
Budget time for surprises, and expect the first draft to need editing
rather than to come out right.

---

## Per-trip upload resolution setting

### 11. Per-trip configurable upload resolution
Currently `compressImage` (lib/outbox.js) hard-codes a 2400px max dimension and
q82 JPEG quality for every upload on every trip. For scrapbook-style books with
multi-photo layouts this is fine, but owners should be able to set a higher cap
for trips they know will be printed.

**Context:** The "original" stored in S3 (photos.s3_key) is what the book PDF
renderer and the download endpoint both serve. The client-side compress happens
before the PUT, so the resolution setting must be sent to the client and applied
in compressImage. The server never re-encodes the original — only derivatives
(preview 1600px, thumb 640px) are made server-side in lib/derivatives.js.

**Schema change:** Add `upload_max_dim INTEGER NOT NULL DEFAULT 2400` to the
`trips` table (additive, idempotent). The column drives the cap sent in the trip
API response and read by the upload flow.

**The four preset tiers (maxDim → effective full-bleed DPI for 8.5in page):**

| Label | maxDim | Full-bleed DPI | Use case |
|---|---|---|---|
| Smaller files (faster upload) | 1600 | 188 DPI | Screen-only trips, no printing |
| Default | 2400 | 282 DPI | Scrapbook layouts; fine for most print |
| Higher | 3000 | 353 DPI | Full-bleed pages, safe print margin |
| Highest | 4000 | 470 DPI | Future-proof; large-format or close-crop |

Note: 300 DPI is the standard print floor. Full-bleed is the worst case;
smaller layouts (two-up, three-grid, photo-text) are well above 300 DPI even
at the Default tier.

**New trip flow:** After the trip name, prompt for upload resolution with a
dropdown defaulting to "Default (2400px)". One extra step; no new page needed.

**Trip settings:** Add a "Upload resolution" card (owner/admin only) with the
same dropdown and a Save button. Changing mid-trip affects future uploads only —
photos already in S3 are immutable and their s3_key does not change.

**Upload flow changes:** `GET /api/trips/[id]` already returns the trip row;
add `upload_max_dim` to that response. TripView.js reads it and passes it to
`compressImage(f, trip.upload_max_dim)`.

**Not in scope:** Re-processing existing photos at a new resolution, or
exposing the quality (q82) parameter — the DPI cap is the meaningful knob
for print, and JPEG quality at q82 is indistinguishable from higher at these
dimensions.

---

## Quick wins, high daily value

### 5. Flag new items since a member's last visit
`users.last_active_at` already exists (hourly heartbeat in
`lib/auth.js#currentUser`). "New" = created after the viewer's previous
visit. A dot on the day divider or on individual items. Self-contained.

### 6. Pinch-zoom and pan in the lightbox
Small, no schema, no storage. Most-used gesture on a phone (reading a sign,
a license plate, a menu). Ship this on its own — do NOT bundle it with
photo editing (item 9), or the hard feature will hold the easy one hostage.

### 7. Map overlay of where photos were taken
All the data already exists (`photos.lat/lng`, `entries.lat/lng`); this is
purely a rendering feature. Recommendation: **Leaflet + OpenStreetMap
tiles** — no API key, no billing account, and consistent with already using
Nominatim for geocoding. Mapbox/Google both look better and both want a
credit card for what is a family scrapbook.

Decisions to make: per-trip map (pins for the whole trip, tap a pin for the
photos there) vs per-day strip. And photos WITHOUT location need somewhere
to live in that UI — iOS strips EXIF GPS by default in the picker, so there
will be plenty of them; they must not silently vanish.

---

## Bigger projects, each needs a spec first

### 8. Notifications for new notes/photos
Per-user configuration of channel (email/SMS) and frequency (real-time,
hourly, daily). Requires a scheduled job (cron on the instance is fine at
this scale; EventBridge if it grows).

Scoping warning: **SMS means A2P 10DLC carrier registration**, which is
weeks of paperwork for any meaningful volume. Scope v1 to email digests
only and treat SMS as a separate epic. Write `docs/SPEC-NOTIFICATIONS.md`
with numbered locked decisions before coding.

### 9. Photo editing: crop, brightness, contrast, color
Needs `docs/SPEC-PHOTO-EDITING.md` answering these BEFORE any code:

- Destructive or non-destructive? Overwriting the original breaks the
  "S3 objects are immutable" invariant that the URL cache and thumbnail
  tiers depend on. Non-destructive (original + edited key + stored
  adjustment parameters) is almost certainly right.
- Whose edit wins? Five members share one photo. Per-user edits, or one
  canonical edited version?
- Derivative regeneration: an edit invalidates `thumb_key` and
  `preview_key` and the cached URLs in `photo_urls`.
- Which version does the BOOK use? This negotiates directly with item 1.

### 10. Let contributors group photos they don't own
Currently `POST /api/entries/[id]/photos` only lets you attach your OWN
loose photos (moderators can attach anyone's). Relaxing this is a small
code change but a deliberate reversal of a permission guardrail.

Think through the boundary first: if anyone can pull anyone's photo into a
note, can they also ungroup or delete it? Otherwise a member can
effectively hide someone else's photo inside a note they control.

---

## Known debt, never closed

- **Service worker does not version-bust.** Every deploy leaves installed
  PWAs serving stale JS/CSS until the cache turns over — this is why every
  verification step in the last month said "check incognito first". Fix:
  inject the git SHA as the cache name at build time and delete old caches
  on activate. Small, and it makes every future fix land immediately on the
  family's phones.
- **The share link always creates contributors.** `invite_code` has no role
  attached, so anyone joining via the link becomes a full contributor;
  viewers require an emailed invite. Fix options: label the link
  "contributors only" in the UI, or add a second `viewer_invite_code` so a
  view-only link can be dropped in a group chat.
- **No warning for missing env vars.** `ADMIN_EMAILS` was added to
  `.env.example` but not to the server's untracked `.env`, which surfaced
  as a confusing 403 on the admin backfill endpoint weeks later. Fix: a
  startup check that logs a loud warning for any key present in
  `.env.example` and absent from the environment.
- **SES production access status unknown.** The sandbox rejects any
  unverified recipient, which silently blocked the first real viewer
  invite. Confirm the AWS support case was resolved; until it is, every new
  family member's address must be individually verified in SES.
- **No functional test suite.** CI proves the app builds and that
  `schema.sql` applies twice cleanly against a seeded database. Feature
  correctness rests on manual dev-rig testing and PR review. If this ever
  warrants automation, the `LLM_MOCK=1` machinery was built to make
  Playwright-in-CI cheap.

---

## Suggested order

1. Items 1 and 2 (verification only — may cost nothing and retire the
   biggest book risk immediately)
2. Item 3 (dates), then item 5 or 6 as a warm-up
3. Print vendor spec research, then a real book generation against the
   Netherlands trip — expect this to generate its own list of issues
4. Everything else, re-prioritized after you've seen a real draft
