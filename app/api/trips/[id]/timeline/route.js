import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { presignGet } from "@/lib/s3";

export async function GET(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const person = new URL(req.url).searchParams.get("person");

  const entries = await q(
    `SELECT e.id, e.ts, e.text, e.place_name, e.user_id, u.name AS author
     FROM entries e JOIN users u ON u.id=e.user_id
     WHERE e.trip_id=$1 ${person ? "AND e.user_id=$2" : ""} ORDER BY e.ts`,
    person ? [params.id, person] : [params.id]);
  const photos = await q(
    `SELECT p.id, p.ts, p.place_name, p.entry_id, p.user_id, p.preview_key, p.lat, p.lng,
            p.width, p.height, u.name AS author
     FROM photos p JOIN users u ON u.id=p.user_id
     WHERE p.trip_id=$1 AND p.status='ready' AND p.kind='photo' ${person ? "AND p.user_id=$2" : ""}
     ORDER BY p.ts`, person ? [params.id, person] : [params.id]);
  for (const p of photos)
    p.url = p.preview_key ? await presignGet(p.preview_key) : null;

  const byEntry = {};
  for (const p of photos) if (p.entry_id) (byEntry[p.entry_id] ||= []).push(p);
  const items = [
    ...entries.map(e => ({ type: "entry", ts: e.ts, ...e, photos: byEntry[e.id] || [] })),
    ...photos.filter(p => !p.entry_id).map(p => ({ type: "photo", ts: p.ts, ...p }))
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts)); // newest first, top of screen
  return NextResponse.json({ items });
}
