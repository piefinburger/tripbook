import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const [trip] = await q(
    `SELECT t.*, m.role AS my_role FROM trips t
     JOIN trip_members m ON m.trip_id=t.id AND m.user_id=$2
     WHERE t.id=$1`, [params.id, u.id]);
  const members = await q(
    `SELECT u.id, u.name, u.email, m.role FROM trip_members m
     JOIN users u ON u.id=m.user_id WHERE m.trip_id=$1`, [params.id]);
  return NextResponse.json({ trip, members });
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
