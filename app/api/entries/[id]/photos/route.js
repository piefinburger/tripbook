import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute, canModerate } from "@/lib/auth";
import { emitTrip } from "@/lib/events";

// Attach loose photos to an existing note. Any contributor may add their
// OWN photos to any note in the trip (collaborative grouping); moderators
// may attach anyone's. Photos must be loose and in the same trip.
export async function POST(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [entry] = await q("SELECT id, trip_id FROM entries WHERE id=$1", [params.id]);
  if (!entry) return NextResponse.json({ error: "Note not found." }, { status: 404 });
  const role = await requireMember(entry.trip_id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (!canContribute(role))
    return NextResponse.json({ error: "Viewers can look but not change notes." }, { status: 403 });

  const ids = ((await req.json()).photoIds || []).map(Number).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "Pick at least one photo." }, { status: 400 });

  const owns = canModerate(role, u) ? "" : "AND user_id=$4";
  const updated = await q(
    `UPDATE photos SET entry_id=$1
     WHERE id = ANY($2) AND trip_id=$3 AND entry_id IS NULL AND status='ready'
       AND kind='photo' ${owns}
     RETURNING id`,
    canModerate(role, u) ? [entry.id, ids, entry.trip_id] : [entry.id, ids, entry.trip_id, u.id]);
  if (!updated.length)
    return NextResponse.json({ error: "Those photos could not be added (already in a note, or not yours)." }, { status: 400 });

  // Inherit ts/lat/lng from the earliest photo now attached to this entry.
  // Covers the "write note first, attach photos after" flow. original_* columns
  // preserve whatever the entry had before so item #4 can show the audit trail.
  const [earliest] = await q(
    `SELECT ts, lat, lng, place_name FROM photos
     WHERE entry_id=$1 AND status='ready' AND kind='photo'
     ORDER BY ts ASC LIMIT 1`,
    [entry.id]);
  if (earliest) {
    await q(
      `UPDATE entries SET
         original_ts         = COALESCE(original_ts, ts),
         original_lat        = COALESCE(original_lat, lat),
         original_lng        = COALESCE(original_lng, lng),
         original_place_name = COALESCE(original_place_name, place_name),
         ts        = $2,
         lat       = CASE WHEN $3::double precision IS NOT NULL THEN $3 ELSE lat END,
         lng       = CASE WHEN $4::double precision IS NOT NULL THEN $4 ELSE lng END,
         place_name = COALESCE($5, place_name),
         ts_source = 'photo'
       WHERE id=$1`,
      [entry.id, earliest.ts, earliest.lat ?? null, earliest.lng ?? null,
       earliest.place_name ?? null]);
  }

  emitTrip(entry.trip_id);
  return NextResponse.json({ ok: true, added: updated.length });
}
