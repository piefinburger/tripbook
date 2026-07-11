# SPEC: Trip Gallery

Status: FINAL, implemented
Depends on: existing photo pipeline, SPEC-BOOK-EDITOR (tray integration)

## What already exists (no work needed)

The data model already satisfies most of the requirement. Every photo row
is trip-scoped and carries `user_id` (uploader), `ts` (timestamp),
`lat/lng/place_name` (GPS + reverse geocode), and all trip members can
already add photos through the timeline capture bar. The book editor's
photo tray already lists every ready photo in the trip, so anything that
lands in the gallery is automatically available to the book editor with
zero additional plumbing.

What is genuinely missing:
1. A dedicated gallery view (the timeline interleaves photos with notes;
   there is no photo-first browse experience).
2. Bulk upload from the camera roll (capture bar is built around taking
   photos in the moment, one to three at a time).
3. GPS and timestamps for camera-roll uploads (current flow tags device
   location at capture time, which is correct for live capture but wrong
   for uploading last week's photos from your couch).
4. Attribution display (uploader name is stored but never shown).

## Decisions

- D1: New page `/trip/[id]/gallery`, linked from the trip timeline topbar
  and the trip card. Grid of square thumbnails grouped by day with the
  same luggage-tag day dividers as the timeline. Responsive: 3 columns on
  phone, up to 6 on desktop.

- D2: Every member can upload; upload lives in the gallery as a
  multi-select file input (`multiple` on the input; iOS presents the
  photo-library picker). Uploads reuse the existing pipeline unchanged:
  client-side compress to preview, presigned PUT of original + preview,
  offline-safe via the same IndexedDB outbox.

- D3: Metadata for library uploads comes from EXIF, parsed client-side
  from the ORIGINAL file before compression (canvas re-encoding strips
  EXIF, so parse first). Priority order:
  - Timestamp: EXIF DateTimeOriginal > file lastModified > now.
  - GPS: EXIF GPS coordinates only. We deliberately do NOT fall back to
    device geolocation for library uploads; tagging beach photos with
    your living room is worse than no tag. Live capture keeps the current
    device-geolocation behavior.
  Parsing is a small vendored EXIF reader (no heavy dependency); JPEG and
  HEIC-converted-to-JPEG covered.

- D4: iOS limitation, called out in the UI: iOS strips location EXIF from
  photos shared through the picker unless the user enables it per-share
  (Options > Location in the picker sheet) or grants full photo access.
  Untagged photos show "no location" and the gallery lightbox offers a
  one-tap "Set place" that geocodes a typed place name. No map-pin
  editor in v1.

- D5: Lightbox on tap: full preview, uploader name, date/time, place
  name, and (owner or uploader only) Delete. Swipe/arrow between photos.

- D6: Permissions: members view and upload; a member can delete their own
  photos; the trip owner can delete any photo. Deleting a photo that is
  used in the book draft removes it from those pages (same cleanup logic
  the editor's exclude already uses) and cuts a draft revision so it is
  undoable.

- D7: Attribution chip on thumbnails is initials-only (e.g. "DP") to keep
  the grid clean; full name in the lightbox. Filter bar: All / by member /
  Untagged location.

- D8: Gallery uploads with EXIF GPS get the same Nominatim reverse
  geocode as live captures, server-side on the existing path.

- D9: No new tables. One additive column: `photos.source`
  ('capture' | 'library') for future analytics and to suppress the
  "no location" nag on captures that legitimately had location off.

- D10: Book editor integration is confirmed-by-test, not built: the
  acceptance test verifies a gallery-uploaded photo appears in the editor
  tray and can be placed on a page.

## Resolved questions (owner decisions)

- Q1 -> D11: Videos ARE accepted (mp4, mov, webm) for record keeping.
  Storage-only: they appear in the gallery and play in the lightbox, and
  are excluded from every book path (editor tray, generation corpus,
  vision scoring, draft validation, timeline). The client extracts a
  poster frame, dimensions, and duration before upload; timestamp comes
  from the MP4 mvhd creation atom when present (first 4 MB scanned),
  else file lastModified. Uploads are online-only; large video blobs are
  not queued in the IndexedDB outbox. Playback note: iPhone .mov files
  use HEVC, which some desktop Chrome installs cannot decode; Safari
  plays them natively.
- Q2 -> D12: Lightbox has "Download original" via a presigned GET with an
  attachment Content-Disposition.
- Q3 -> D13: No cap on bulk selection. Sequential per-file upload queue
  with a visible counter; failures surface per file and do not stop the
  queue. Uploads go browser -> S3 directly, so the instance is never the
  data path.

## Acceptance additions (runbook Phase 8)

- Upload 3 photos from the camera roll on the phone; they appear in the
  gallery under the day they were TAKEN (not today), with the uploader's
  initials.
- Second family member sees them within one refresh.
- One of them is placeable onto a page in the book editor from the tray.
- Delete a photo you uploaded; it disappears from gallery and any draft
  page it was on; History shows a restorable revision.
