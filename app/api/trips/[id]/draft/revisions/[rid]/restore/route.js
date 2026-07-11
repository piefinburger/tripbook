import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { getOrNullDraft } from "@/lib/book";

export async function POST(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const draft = await getOrNullDraft(params.id);
  const [rev] = await q(
    "SELECT spec FROM book_draft_revisions WHERE id=$1 AND draft_id=$2",
    [params.rid, draft?.id]);
  if (!rev) return NextResponse.json({ error: "Revision not found." }, { status: 404 });
  await q(
    "INSERT INTO book_draft_revisions (draft_id, spec, source, note) VALUES ($1,$2,'restore',$3)",
    [draft.id, JSON.stringify(draft.spec), `before restoring #${params.rid}`]);
  await q("UPDATE book_drafts SET spec=$1, updated_at=now() WHERE id=$2",
    [rev.spec, draft.id]);
  return NextResponse.json({ ok: true });
}
