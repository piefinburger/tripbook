import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute } from "@/lib/auth";
import { getDraftById, getOrNullDraft, listDrafts, saveDraftSpec } from "@/lib/book";
import { ensureV2, validateSpec } from "@/lib/specops";

export async function GET(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (!canContribute(role))
    return NextResponse.json({ error: "The book is not visible to viewers." }, { status: 403 });

  const drafts = await listDrafts(params.id);

  const draftIdParam = new URL(req.url).searchParams.get("draftId");
  let draft = null;
  if (draftIdParam) {
    draft = await getDraftById(draftIdParam);
    if (!draft || String(draft.trip_id) !== String(params.id)) draft = null;
  }
  if (!draft) draft = drafts[0] ? await getDraftById(drafts[0].id) : null;

  if (!draft) return NextResponse.json({ draft: null, drafts: [], revisions: [] });

  const revisions = await q(
    `SELECT id, source, note, created_at FROM book_draft_revisions
     WHERE draft_id=$1 ORDER BY id DESC`, [draft.id]);
  return NextResponse.json({
    draft: { ...draft, spec: ensureV2(draft.spec) },
    drafts: drafts.map(d => ({ id: Number(d.id), name: d.name, status: d.status, created_at: d.created_at })),
    revisions
  });
}

export async function PUT(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const { spec, cutRevision, draftId } = await req.json();
  const clean = ensureV2(spec);
  const photos = await q(
    "SELECT id FROM photos WHERE trip_id=$1 AND status='ready' AND kind='photo'", [params.id]);
  const errors = validateSpec(clean, photos);
  if (errors.length)
    return NextResponse.json({ error: "Invalid layout", details: errors }, { status: 400 });
  await saveDraftSpec(params.id, clean, !!cutRevision, draftId);
  return NextResponse.json({ ok: true });
}
