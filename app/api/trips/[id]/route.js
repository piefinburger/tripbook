import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, isSiteAdmin } from "@/lib/auth";
import { deleteObject } from "@/lib/s3";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response && !isSiteAdmin(u)) return role;
  const [trip] = await q(
    `SELECT t.*, m.role AS my_role FROM trips t
     LEFT JOIN trip_members m ON m.trip_id=t.id AND m.user_id=$2
     WHERE t.id=$1`, [params.id, u.id]);
  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
  const members = await q(
    `SELECT u.id, u.name, u.email, m.role FROM trip_members m
     JOIN users u ON u.id=m.user_id WHERE m.trip_id=$1`, [params.id]);
  return NextResponse.json({ trip, members,
    me: Number(u.id), siteAdmin: isSiteAdmin(u) });
}

// Delete the whole trip: owner or site admin. Removes S3 media first,
// then the trip row (DB cascades take entries, photos, drafts, exports).
export async function DELETE(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response && !isSiteAdmin(u)) return role;
  if (role !== "owner" && !isSiteAdmin(u))
    return NextResponse.json({ error: "Only the trip owner or a site admin can delete a trip." }, { status: 403 });
  const media = await q(
    "SELECT s3_key, preview_key FROM photos WHERE trip_id=$1", [params.id]);
  const pdfs = await q(
    "SELECT pdf_s3_key AS pdf_key FROM book_exports WHERE trip_id=$1 AND pdf_s3_key IS NOT NULL", [params.id]);
  for (const m of media) {
    await deleteObject(m.s3_key).catch(() => {});
    if (m.preview_key) await deleteObject(m.preview_key).catch(() => {});
  }
  for (const x of pdfs) await deleteObject(x.pdf_key).catch(() => {});
  await q("DELETE FROM trips WHERE id=$1", [params.id]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const { name, startDate, endDate, coverPhotoId } = await req.json();
  await q(
    `UPDATE trips SET name=COALESCE($2,name), start_date=COALESCE($3,start_date),
       end_date=COALESCE($4,end_date), cover_photo_id=COALESCE($5,cover_photo_id)
     WHERE id=$1`,
    [params.id, name || null, startDate || null, endDate || null, coverPhotoId || null]);
  return NextResponse.json({ ok: true });
}
