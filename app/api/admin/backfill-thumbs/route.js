import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, isSiteAdmin } from "@/lib/auth";
import { getObjectBuffer } from "@/lib/s3";
import { makeDerivatives, makeThumbFromPoster } from "@/lib/derivatives";

// One-off backfill for photos uploaded before the thumbnail tier existed.
// Resumable by construction: it always selects WHERE thumb_key IS NULL, so
// re-running picks up exactly what is left. Site admin only.
const g = globalThis;
g.__backfill ??= { running: false, done: 0, total: 0, errors: 0 };

export const maxDuration = 300;

export async function GET() {
  const u = await currentUser();
  if (!u || !isSiteAdmin(u))
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  const [{ remaining }] = await q(
    "SELECT count(*)::int AS remaining FROM photos WHERE status='ready' AND thumb_key IS NULL");
  return NextResponse.json({ ...g.__backfill, remaining });
}

export async function POST() {
  const u = await currentUser();
  if (!u || !isSiteAdmin(u))
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  run(); // fire and forget; poll GET for progress
  return NextResponse.json({ started: true });
}

async function run() {
  if (g.__backfill.running) return;
  const rows = await q(
    `SELECT id, s3_key, preview_key, kind FROM photos
     WHERE status='ready' AND thumb_key IS NULL ORDER BY id`);
  g.__backfill = { running: true, done: 0, total: rows.length, errors: 0 };
  try {
    for (const p of rows) {
      try {
        if (p.kind === "video") {
          if (p.preview_key) {
            const tk = await makeThumbFromPoster(p.preview_key);
            await q("UPDATE photos SET thumb_key=$2 WHERE id=$1", [p.id, tk]);
          }
        } else {
          const buf = await getObjectBuffer(p.s3_key);
          const d = await makeDerivatives(buf, p.s3_key);
          await q("UPDATE photos SET thumb_key=$2, preview_key=$3 WHERE id=$1",
            [p.id, d.thumbKey, d.previewKey]);
        }
      } catch { g.__backfill.errors += 1; }
      g.__backfill.done += 1;
    }
  } finally { g.__backfill.running = false; }
}
