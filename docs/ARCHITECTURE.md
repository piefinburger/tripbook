# Tripbook Architecture

Target: tripbook.pfeif.us on a single new Lightsail instance in personal AWS
account 416369639144. Postgres in Docker on the instance with nightly dumps to
S3. Media in S3. SES for magic links. Claude API (Sonnet) for book generation.

## Topology

```
iOS Safari PWA / laptop browser
        |
      HTTPS (Caddy, auto Let's Encrypt)
        |
  Next.js app (Docker, port 3000)  ----  Postgres 16 (Docker, port 5432, internal)
        |                                        |
        |                                nightly pg_dump -> s3://tripbook-media-<acct>/backups/
        |
   S3 (tripbook-media): originals/, previews/, exports/
        |
   SES (magic links)      Anthropic API (book generation)
```

One docker-compose file runs caddy, app, and postgres. No other moving parts.

## Auth: magic links

1. POST /api/auth/request-link with email. Server writes a single-use token
   (32 random bytes, SHA-256 stored, 15-minute expiry) and sends the link via
   SES.
2. GET /api/auth/verify?token= consumes the token, upserts the user, sets an
   HMAC-signed session cookie (30 days, httpOnly, Secure, SameSite=Lax).
3. No passwords anywhere. Sessions are stateless signed cookies; revocation is
   not needed at this scale.

SES note: the account must be out of the SES sandbox OR every family member's
address must be verified. Sending domain pfeif.us (or mail.pfeif.us) needs
DKIM records. This is the only external setup step that can block invites.

## Photo upload flow (mobile Safari)

Direct-to-S3 with presigned PUT. The instance never proxies photo bytes:

1. Client captures via `<input type="file" accept="image/*" capture>` or
   getUserMedia, reads EXIF-independent GPS from the Geolocation API at
   capture time (Safari strips location EXIF from library picks; see flags).
2. POST /api/photos/presign returns { photoId, putUrl } for
   originals/{tripId}/{photoId}.jpg.
3. Client PUTs the file straight to S3.
4. POST /api/photos/complete confirms; server generates a 1600px preview with
   sharp, writes previews/{tripId}/{photoId}.webp, inserts the row.
5. Timeline serves preview URLs (presigned GET, 1h) so the bucket stays
   private.

## Offline strategy (the honest iOS version)

iOS Safari has **no Background Sync API and no periodic sync**. Anything
queued offline only syncs while the PWA is open in the foreground. Design
around that instead of pretending:

- Service worker precaches the app shell (offline-first navigation).
- Entries and photos created offline are written to IndexedDB (`outbox`).
- A flush runs on: app launch, `online` event, `visibilitychange` to visible,
  and after every successful mutation. A visible "N items waiting to sync"
  chip tells the user to open the app on WiFi.
- Storage: iOS grants roughly 60% of free disk to an installed PWA but **can
  evict all site data if the PWA is unused for weeks** (Intelligent Tracking
  Prevention exempts home-screen apps, but eviction under disk pressure is
  real). Mitigation: photos are compressed to <= ~2.5MB before queueing, the
  outbox nags, and nothing is ever *only* on the device once synced.

## Book generation pipeline

1. Owner hits Generate (mode A auto-narrative or mode B curated).
2. Server assembles the trip corpus: entries, authors, timestamps, place
   names, photo manifest (id, timestamp, place, author, aspect ratio).
3. One Claude call (claude-sonnet-4-6, JSON-only prompt) returns a layout
   spec: `{ title, chapters: [{ title, narrative?, pages: [{ template,
   photoIds, caption?, text? }] }] }`. Mode B's prompt forbids invented prose;
   it may only reorder, group, and fix typos, and the diff is limited to the
   family's own words.
4. Spec is stored on the export row. Owner previews at /book/preview/{id}
   (HTML rendering of the spec) and can re-run.
5. Export: Puppeteer (already on the instance in the app image) renders
   /book/render/{id} — a print CSS document, 8.5x8.5in pages, 300 DPI images
   (originals, not previews) — to PDF, uploads to exports/, marks the row
   done. Runs as an in-process job; at 5 users a queue is overkill, but the
   job table means a crashed render is visible and re-runnable.

## Safari limitation flags (the ones that change UX)

1. **No Background Sync** — foreground-only outbox flush, with visible sync
   state. Already designed in above.
2. **getUserMedia in standalone PWAs**: works on iOS >= 16.4 but has a
   history of bugs after app switching (black preview until relaunch). v1
   default is the file input with `capture="environment"`, which opens the
   native camera reliably; getUserMedia is the enhancement, not the base.
3. **EXIF GPS is stripped** when picking from the photo library in Safari.
   So geo comes from the Geolocation API at *capture/attach time*, and a
   library-picked old photo gets tagged with "added at" location unless the
   user edits it. The entry editor exposes the place field for correction.
4. **No web push without setup**: iOS supports push for installed PWAs since
   16.4 but requires explicit permission UX. v1 skips push entirely; the
   timeline polls every 30s while visible.
5. **Web Speech API**: `webkitSpeechRecognition` exists on iOS Safari but is
   flaky in standalone mode and requires network. UI shows the mic only when
   the API reports availability, always with the keyboard as the primary
   path. Dictation via the iOS keyboard mic is the reliable fallback and
   costs us nothing.
6. **7-day storage cap does not apply** to installed (home screen) PWAs, but
   Safari-tab usage before install is subject to it. The invite landing page
   pushes "Add to Home Screen" hard, with inline instructions, because the
   share-sheet flow is undiscoverable.
7. **100MB service worker cache is not the limit for IndexedDB**, so photo
   blobs queue in IndexedDB, never the Cache API.

## Backups and ops

- `deploy/backup.sh` runs nightly via cron: pg_dump | gzip | aws s3 cp, keep
  14 days by S3 lifecycle rule.
- Caddy handles TLS renewal unattended.
- Deploy = git pull && docker compose build app && docker compose up -d.
- Logs: `docker compose logs -f app`. No external monitoring for v1.
