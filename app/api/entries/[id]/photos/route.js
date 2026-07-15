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
  emitTrip(entry.trip_id);
  return NextResponse.json({ ok: true, added: updated.length });
}
