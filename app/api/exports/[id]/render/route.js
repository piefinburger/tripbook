import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { renderExportPdf } from "@/lib/pdf";

export async function POST(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [ex] = await q("SELECT trip_id, status FROM book_exports WHERE id=$1", [params.id]);
  if (!ex) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const role = await requireMember(ex.trip_id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner")
    return NextResponse.json({ error: "Only the trip owner can export." }, { status: 403 });
  if (!["preview", "error", "done"].includes(ex.status))
    return NextResponse.json({ error: "Generation still running." }, { status: 409 });
  renderExportPdf(params.id); // async; poll status
  return NextResponse.json({ ok: true });
}
