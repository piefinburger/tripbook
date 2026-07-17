// Server-side presigned URL cache (Postgres-backed).
//
// Why this exists: presigning generates a NEW signature every call, so the
// URL string changes on every page load and the browser can never cache the
// image bytes. Handing back a stable URL for the life of the signature turns
// every revisit into a browser cache hit.
//
// Safety: we cache a URL for an S3 OBJECT, and objects here are immutable
// (uploads write new keys; nothing is ever overwritten in place). So a
// cached URL cannot serve stale content. Grouping, editing, and note changes
// touch database columns only and are always read fresh; they never flow
// through this cache. Deletes cascade the row away via FK.
import { q } from "./db";
import { presignGet } from "./s3";

const SIGN_SECONDS = 26 * 3600;   // signature lifetime
const REUSE_MARGIN_MS = 2 * 3600 * 1000; // re-sign when under 2h remains

// Batch: takes rows with {id, thumb_key, preview_key}, returns
// { [photoId]: { thumb, preview } } using cached URLs where possible.
export async function urlsForPhotos(rows, tiers = ["thumb", "preview"]) {
  const ids = rows.map(r => Number(r.id));
  const out = {};
  for (const id of ids) out[id] = {};
  if (!ids.length) return out;

  const cached = await q(
    `SELECT photo_id, tier, url FROM photo_urls
     WHERE photo_id = ANY($1) AND expires_at > now() + interval '2 hours'`, [ids]);
  for (const c of cached) out[Number(c.photo_id)][c.tier] = c.url;

  const fresh = [];
  for (const r of rows) {
    const id = Number(r.id);
    for (const tier of tiers) {
      if (out[id][tier]) continue;
      const key = tier === "thumb" ? (r.thumb_key || r.preview_key) : r.preview_key;
      if (!key) { out[id][tier] = null; continue; }
      const url = await presignGet(key, { expiresIn: SIGN_SECONDS });
      out[id][tier] = url;
      fresh.push({ id, tier, url });
    }
  }
  if (fresh.length) {
    await q(
      `INSERT INTO photo_urls (photo_id, tier, url, expires_at)
       SELECT * FROM UNNEST($1::bigint[], $2::text[], $3::text[],
                            $4::timestamptz[])
       ON CONFLICT (photo_id, tier) DO UPDATE
         SET url = EXCLUDED.url, expires_at = EXCLUDED.expires_at`,
      [fresh.map(f => f.id), fresh.map(f => f.tier), fresh.map(f => f.url),
       fresh.map(() => new Date(Date.now() + SIGN_SECONDS * 1000))]);
  }
  return out;
}

// Single photo, single tier (used by lightbox/download paths).
export async function urlForPhoto(row, tier = "preview") {
  const m = await urlsForPhotos([row], [tier]);
  return m[Number(row.id)][tier];
}

// Best-effort hygiene: rows cascade on photo delete, this just clears
// anything expired so the table stays small.
export async function sweepExpiredUrls() {
  await q("DELETE FROM photo_urls WHERE expires_at < now()").catch(() => {});
}
