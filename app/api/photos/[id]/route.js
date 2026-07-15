import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canModerate, isSiteAdmin } from "@/lib/auth";
import { deleteObject, presignGet } from "@/lib/s3";
import { getOrNullDraft } from "@/lib/book";
import { searchPlace } from "@/lib/geocode";
import { emitTrip } from "@/lib/events";

async function loadPhoto(id, user) {
  const [p] = await q("SELECT * FROM photos WHERE id=$1", [id]);
  if (!p) return [null, NextResponse.json({ error: "Not found." }, { status: 404 })];
  const role = await requireMember(p.trip_id, user.id).catch(r => r);
  if (role instanceof Response && !isSiteAdmin(user)) return [null, role];
  const tripRole = role instanceof Response ? null : role;
  return [{ ...p, role: tripRole,
    canModify: canModerate(tripRole, user) || Number(p.user_id) === Number(user.id) }, null];
}

// Download original: presigned GET with attachment disposition.
export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [p, err] = await loadPhoto(params.id, u);
  if (err) return err;
  const url = await presignGet(p.s3_key, {
    download: p.s3_key.split("/").pop() });
  return NextResponse.json({ url });
}

// PATCH handles two edits: setting a place name, or ungrouping the photo
// from its note (entry) so it returns to the timeline as a loose photo.
export async function PATCH(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [p, err] = await loadPhoto(params.id, u);
  if (err) return err;
  if (!p.canModify)
    return NextResponse.json({ error: "Only the uploader or a trip admin can edit this." }, { status: 403 });
  const body = await req.json();

  if (body.ungroup) {
    if (!p.entry_id)
      return NextResponse.json({ error: "This photo is not part of a note." }, { status: 400 });
    await q("UPDATE photos SET entry_id=NULL WHERE id=$1", [p.id]);
    // If the note is now an empty husk (no text, no photos), remove it.
    const [e] = await q(
      `SELECT e.id, e.text,
              (SELECT count(*) FROM photos WHERE entry_id=e.id) AS n
       FROM entries e WHERE e.id=$1`, [p.entry_id]);
    if (e && Number(e.n) === 0 && !(e.text || "").trim())
      await q("DELETE FROM entries WHERE id=$1", [e.id]);
    emitTrip(p.trip_id);
    return NextResponse.json({ ok: true, entryRemoved: e ? Number(e.n) === 0 && !(e.text || "").trim() : false });
  }

  const { placeName } = body;
  const text = String(placeName || "").trim().slice(0, 120);
  if (!text) return NextResponse.json({ error: "Type a place name." }, { status: 400 });
  const hit = await searchPlace(text);
  await q("UPDATE photos SET place_name=$2, lat=COALESCE($3,lat), lng=COALESCE($4,lng) WHERE id=$1",
    [params.id, hit?.name || text, hit?.lat ?? null, hit?.lng ?? null]);
  emitTrip(p.trip_id);
  return NextResponse.json({ ok: true, placeName: hit?.name || text });
}

// Delete: uploader or trip owner. Cleans the photo out of the book draft
// (revision cut first so it is undoable), then removes S3 objects and row.
export async function DELETE(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [p, err] = await loadPhoto(params.id, u);
  if (err) return err;
  if (!p.canModify)
    return NextResponse.json({ error: "Only the uploader or a trip admin can delete this." }, { status: 403 });

  const draft = await getOrNullDraft(p.trip_id);
  if (draft?.spec?.chapters) {
    const id = Number(p.id);
    const spec = JSON.parse(JSON.stringify(draft.spec));
    let touched = false;
    const byCount = { 0: "text-only", 1: "full-bleed", 2: "two-up", 3: "three-grid" };
    for (const ch of spec.chapters) {
      for (const pg of ch.pages) {
        if (!pg.photoIds?.map(Number).includes(id)) continue;
        touched = true;
        pg.photoIds = pg.photoIds.map(Number).filter(x => x !== id);
        if (pg.template !== "photo-text" || pg.photoIds.length === 0)
          pg.template = byCount[Math.min(pg.photoIds.length, 3)];
      }
      ch.pages = ch.pages.filter(pg =>
        pg.pinned || pg.photoIds?.length || (pg.text || "").trim());
    }
    spec.excludedPhotoIds = (spec.excludedPhotoIds || []).map(Number).filter(x => x !== id);
    if (touched) {
      await q(
        `INSERT INTO book_draft_revisions (draft_id, spec, source, note)
         VALUES ($1,$2,'manual',$3)`,
        [draft.id, JSON.stringify(draft.spec), "before photo deletion"]);
      await q("UPDATE book_drafts SET spec=$1, updated_at=now() WHERE id=$2",
        [JSON.stringify(spec), draft.id]);
    }
  }

  await deleteObject(p.s3_key).catch(() => {});
  if (p.preview_key) await deleteObject(p.preview_key).catch(() => {});
  await q("DELETE FROM photos WHERE id=$1", [params.id]);
  emitTrip(p.trip_id);
  return NextResponse.json({ ok: true });
}
