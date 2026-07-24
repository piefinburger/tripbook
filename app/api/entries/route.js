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

  // Resolve effective ts/lat/lng: if photos are attached, inherit the earliest
  // photo's timestamp and location. The client-sent values are preserved in
  // original_* columns regardless, giving item #4 (manual edit) an audit trail.
  const originalTs = ts || new Date().toISOString();
  const originalLat = lat ?? null;
  const originalLng = lng ?? null;

  let effectiveTs = originalTs;
  let effectiveLat = originalLat;
  let effectiveLng = originalLng;

  if (Array.isArray(photoIds) && photoIds.length) {
    const photos = await q(
      `SELECT ts, lat, lng FROM photos
       WHERE id = ANY($1) AND trip_id=$2 AND user_id=$3 AND status='ready'
       ORDER BY ts ASC LIMIT 1`,
      [photoIds, tripId, u.id]);
    if (photos.length) {
      effectiveTs = photos[0].ts;
      effectiveLat = photos[0].lat ?? originalLat;
      effectiveLng = photos[0].lng ?? originalLng;
    }
  }

  const place = await reverseGeocode(effectiveLat, effectiveLng);
  const [entry] = await q(
    `INSERT INTO entries
       (trip_id, user_id, client_id, ts, lat, lng, place_name, text,
        original_ts, original_lat, original_lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (client_id) DO UPDATE SET text=EXCLUDED.text
     RETURNING id`,
    [tripId, u.id, clientId || null, effectiveTs, effectiveLat, effectiveLng,
     place, finalText, originalTs, originalLat, originalLng]);
  if (Array.isArray(photoIds) && photoIds.length)
    await q(
      `UPDATE photos SET entry_id=$1 WHERE id = ANY($2) AND trip_id=$3 AND user_id=$4`,
      [entry.id, photoIds, tripId, u.id]);
  emitTrip(tripId);
  return NextResponse.json({ id: entry.id, placeName: place });
}
