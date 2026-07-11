import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { presignGet } from "@/lib/s3";

// Full photo list for the editor tray, with scores and previews.
export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const photos = await q(
    `SELECT p.id, p.ts, p.place_name, p.preview_key, p.width, p.height,
            p.quality, p.dup_group, u.name AS author
     FROM photos p JOIN users u ON u.id=p.user_id
     WHERE p.trip_id=$1 AND p.status='ready' AND p.kind='photo' ORDER BY p.ts`, [params.id]);
  for (const p of photos) {
    p.url = p.preview_key ? await presignGet(p.preview_key) : null;
    p.id = Number(p.id);
  }
  return NextResponse.json({ photos });
}
