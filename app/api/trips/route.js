import { NextResponse } from "next/server";
import crypto from "crypto";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { presignGet } from "@/lib/s3";

export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trips = await q(
    `SELECT t.id, t.name, t.start_date, t.end_date, m.role, t.invite_code,
            p.preview_key,
            (SELECT count(*) FROM photos WHERE trip_id=t.id AND status='ready') AS photo_count
     FROM trips t
     JOIN trip_members m ON m.trip_id=t.id AND m.user_id=$1
     LEFT JOIN photos p ON p.id=t.cover_photo_id
     ORDER BY t.start_date DESC NULLS LAST, t.id DESC`, [u.id]);
  for (const t of trips)
    t.cover_url = t.preview_key ? await presignGet(t.preview_key) : null;
  return NextResponse.json({ trips });
}

export async function POST(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name, startDate, endDate } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Trip needs a name." }, { status: 400 });
  const code = crypto.randomBytes(6).toString("base64url");
  const [trip] = await q(
    `INSERT INTO trips (name, start_date, end_date, owner_id, invite_code)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [name.trim(), startDate || null, endDate || null, u.id, code]);
  await q("INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')", [trip.id, u.id]);
  return NextResponse.json({ id: trip.id });
}
