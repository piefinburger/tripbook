import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { presignGet } from "@/lib/s3";
import { urlsForPhotos } from "@/lib/photoUrls";

// Gallery feed: photos AND videos, newest trip content first by capture day.
export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const items = await q(
    `SELECT p.id, p.ts, p.place_name, p.preview_key, p.thumb_key, p.width, p.height,
            p.kind, p.duration_s, p.user_id, u.name AS author
     FROM photos p JOIN users u ON u.id=p.user_id
     WHERE p.trip_id=$1 AND p.status='ready' ORDER BY p.ts`, [params.id]);
  const members = await q(
    `SELECT u.id, u.name FROM trip_members m JOIN users u ON u.id=m.user_id
     WHERE m.trip_id=$1 ORDER BY u.name`, [params.id]);
  const urls = await urlsForPhotos(items);
  for (const p of items) {
    p.id = Number(p.id); p.user_id = Number(p.user_id);
    p.url = urls[p.id]?.thumb || null;        // grid
    p.fullUrl = urls[p.id]?.preview || null;  // lightbox
    delete p.preview_key; delete p.thumb_key;
    if (p.kind === "video") {
      const [row] = await q("SELECT s3_key FROM photos WHERE id=$1", [p.id]);
      p.videoUrl = await presignGet(row.s3_key); // originals stay uncached
    }
  }
  return NextResponse.json({ items,
    members: members.map(m => ({ id: Number(m.id), name: m.name })),
    me: Number(u.id) });
}
