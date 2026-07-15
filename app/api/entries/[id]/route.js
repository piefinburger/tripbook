import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canModerate, isSiteAdmin } from "@/lib/auth";
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
  const { text } = await req.json();
  const clean = String(text || "").slice(0, 20000);
  if (!clean.trim())
    return NextResponse.json({ error: "A note cannot be empty. Delete it instead." }, { status: 400 });
  await q("UPDATE entries SET text=$2 WHERE id=$1", [e.id, clean]);
  emitTrip(e.trip_id);
  return NextResponse.json({ ok: true });
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
