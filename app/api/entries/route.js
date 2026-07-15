import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute } from "@/lib/auth";
import { reverseGeocode } from "@/lib/geocode";
import { polishText } from "@/lib/book";
import { emitTrip } from "@/lib/events";

export async function POST(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tripId, clientId, ts, text, lat, lng, photoIds } = await req.json();
  const role = await requireMember(tripId, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (!canContribute(role))
    return NextResponse.json({ error: "Viewers can look but not add." }, { status: 403 });

  let finalText = String(text || "").slice(0, 20000);
  const [s] = await q(
    "SELECT transcribe_polish_enabled FROM user_settings WHERE user_id=$1", [u.id]);
  if (s?.transcribe_polish_enabled && finalText.trim()) {
    try { finalText = (await polishText(u.id, finalText)).slice(0, 20000); }
    catch { /* polish is best-effort; save the original */ }
  }

  const place = await reverseGeocode(lat, lng);
  const [entry] = await q(
    `INSERT INTO entries (trip_id, user_id, client_id, ts, text, lat, lng, place_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (client_id) DO UPDATE SET text=EXCLUDED.text
     RETURNING id`,
    [tripId, u.id, clientId || null, ts || new Date().toISOString(),
     finalText, lat ?? null, lng ?? null, place]);
  if (Array.isArray(photoIds) && photoIds.length)
    await q(
      `UPDATE photos SET entry_id=$1 WHERE id = ANY($2) AND trip_id=$3 AND user_id=$4`,
      [entry.id, photoIds, tripId, u.id]);
  emitTrip(tripId);
  return NextResponse.json({ id: entry.id, placeName: place });
}
