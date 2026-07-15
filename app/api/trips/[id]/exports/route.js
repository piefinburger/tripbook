import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute } from "@/lib/auth";
import { getOrNullDraft } from "@/lib/book";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (!canContribute(role))
    return NextResponse.json({ error: "The book is not visible to viewers." }, { status: 403 });
  const exports_ = await q(
    `SELECT id, mode, status, error, created_at FROM book_exports
     WHERE trip_id=$1 ORDER BY id DESC LIMIT 10`, [params.id]);
  return NextResponse.json({ exports: exports_ });
}

// Export = immutable snapshot of the current draft (SPEC-BOOK-EDITOR D1).
export async function POST(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner")
    return NextResponse.json({ error: "Only the trip owner can export." }, { status: 403 });
  const draft = await getOrNullDraft(params.id);
  if (!draft || draft.status === "generating" || !draft.spec?.chapters?.length)
    return NextResponse.json({ error: "Generate and review the book first." }, { status: 409 });
  const [ex] = await q(
    `INSERT INTO book_exports (trip_id, mode, status, layout_spec, draft_id)
     VALUES ($1,$2,'preview',$3,$4) RETURNING id`,
    [params.id, draft.mode, JSON.stringify(draft.spec), draft.id]);
  return NextResponse.json({ exportId: ex.id });
}
