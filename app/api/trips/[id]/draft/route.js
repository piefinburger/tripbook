import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { getOrNullDraft, saveDraftSpec } from "@/lib/book";
import { ensureV2, validateSpec } from "@/lib/specops";

export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const draft = await getOrNullDraft(params.id);
  if (!draft) return NextResponse.json({ draft: null, revisions: [] });
  const revisions = await q(
    `SELECT id, source, note, created_at FROM book_draft_revisions
     WHERE draft_id=$1 ORDER BY id DESC`, [draft.id]);
  return NextResponse.json({ draft: { ...draft, spec: ensureV2(draft.spec) }, revisions });
}

export async function PUT(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const { spec, cutRevision } = await req.json();
  const clean = ensureV2(spec);
  const photos = await q(
    "SELECT id FROM photos WHERE trip_id=$1 AND status='ready' AND kind='photo'", [params.id]);
  const errors = validateSpec(clean, photos);
  if (errors.length)
    return NextResponse.json({ error: "Invalid layout", details: errors }, { status: 400 });
  await saveDraftSpec(params.id, clean, !!cutRevision);
  return NextResponse.json({ ok: true });
}
