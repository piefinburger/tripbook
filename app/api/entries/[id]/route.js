import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canModerate, isSiteAdmin } from "@/lib/auth";
import { reverseGeocode, searchPlace } from "@/lib/geocode";
import { emitTrip } from "@/lib/events";

async function loadEntry(id, user) {
  const [e] = await q("SELECT * FROM entries WHERE id=$1", [id]);
  if (!e) return [null, NextResponse.json({ error: "Note not found." }, { status: 404 })];
  const role = await requireMember(e.trip_id, user.id).catch(r => r);
  if (role instanceof Response && !isSiteAdmin(user)) return [null, role];
  const tripRole = role instanceof Response ? null : role;
  const allowed = Number(e.user_id) === Number(user.id) || canModerate(tripRole, user);
  if (!allowed) return [null,
    NextResponse.json({ error: "You can only change your own notes." }, { status: 403 })];
  return [e, null];
}

export async function PUT(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [e, err] = await loadEntry(params.id, u);
  if (err) return err;
  const { text, ts, location } = await req.json();
  const clean = String(text || "").slice(0, 20000);
  if (!clean.trim())
    return NextResponse.json({ error: "A note cannot be empty. Delete it instead." }, { status: 400 });

  // Text-only edit (no ts/location fields sent) — fast path, no geocoding.
  if (!ts && !location) {
    await q("UPDATE entries SET text=$2 WHERE id=$1", [e.id, clean]);
    emitTrip(e.trip_id);
    return NextResponse.json({ ok: true });
  }

  // Manual date/time or location edit.
  const newTs = ts ? new Date(ts).toISOString() : null;
  let newLat = e.lat, newLng = e.lng, newPlace = e.place_name;
  if (location) {
    const hit = await searchPlace(location);
    if (hit) { newLat = hit.lat; newLng = hit.lng; newPlace = hit.name; }
    else { newPlace = location; } // keep coords, use typed text as place name
  }
  if (newTs && !location) {
    // ts changed but location didn't — re-geocode in case it matters (no-op if same coords)
    newPlace = (await reverseGeocode(newLat, newLng)) || newPlace;
  }

  await q(
    `UPDATE entries SET
       text=$2,
       ts        = COALESCE($3, ts),
       lat       = $4, lng = $5, place_name = $6,
       original_ts         = COALESCE(original_ts, ts),
       original_lat        = COALESCE(original_lat, lat),
       original_lng        = COALESCE(original_lng, lng),
       original_place_name = COALESCE(original_place_name, place_name),
       ts_source = 'manual'
     WHERE id=$1`,
    [e.id, clean, newTs, newLat, newLng, newPlace]);
  emitTrip(e.trip_id);
  return NextResponse.json({ ok: true, placeName: newPlace });
}

export async function DELETE(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [e, err] = await loadEntry(params.id, u);
  if (err) return err;
  // photos attached to the note survive; they detach back to loose photos
  await q("UPDATE photos SET entry_id=NULL WHERE entry_id=$1", [e.id]);
  await q("DELETE FROM entries WHERE id=$1", [e.id]);
  emitTrip(e.trip_id);
  return NextResponse.json({ ok: true });
}
