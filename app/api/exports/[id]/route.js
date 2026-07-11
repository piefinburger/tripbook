import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [ex] = await q("SELECT * FROM book_exports WHERE id=$1", [params.id]);
  if (!ex) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try { await requireMember(ex.trip_id, u.id); } catch (r) { return r; }
  return NextResponse.json({ export: ex });
}
