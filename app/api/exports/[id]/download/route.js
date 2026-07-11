import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { presignGet } from "@/lib/s3";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [ex] = await q("SELECT trip_id, pdf_s3_key, status FROM book_exports WHERE id=$1", [params.id]);
  if (!ex?.pdf_s3_key || ex.status !== "done")
    return NextResponse.json({ error: "PDF not ready." }, { status: 404 });
  try { await requireMember(ex.trip_id, u.id); } catch (r) { return r; }
  return NextResponse.redirect(await presignGet(ex.pdf_s3_key, 3600));
}
