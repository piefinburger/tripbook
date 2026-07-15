// Book generation and AI editing against drafts (SPEC-BOOK-EDITOR,
// SPEC-AI-SETTINGS). All model calls go through lib/llm.js.
import { q } from "./db";
import { complete } from "./llm";
import { assembleSystem } from "./prompts";
import { ensureV2, repairSpec, applyOps, APPLY_EDITS_TOOL, usedPhotoIds } from "./specops";
import { getObjectBuffer } from "./s3";

const CURATION_TEXT = {
  everything: "Include every usable photo; duplicates may share a page.",
  balanced: "Select for the story: skip weak or duplicate shots; a week-long trip lands between 20 and 40 pages.",
  highlights: "Be ruthless: only standout moments, at most ~15 pages for a week. Prefer quality >= 70 where scores exist."
};

async function settingsFor(userId) {
  const [s] = await q("SELECT * FROM user_settings WHERE user_id=$1", [userId]);
  return s || { curation_level: "balanced", best_pictures_enabled: false };
}

export async function buildCorpus(tripId, excludedPhotoIds = []) {
  const [trip] = await q("SELECT name, start_date, end_date FROM trips WHERE id=$1", [tripId]);
  const entries = await q(
    `SELECT e.id, e.ts, e.text, e.place_name, u.name AS author
     FROM entries e JOIN users u ON u.id=e.user_id
     WHERE e.trip_id=$1 ORDER BY e.ts`, [tripId]);
  const photos = await q(
    `SELECT p.id, p.ts, p.place_name, p.width, p.height, p.entry_id,
            p.quality, p.vision_tags, p.dup_group, u.name AS author
     FROM photos p JOIN users u ON u.id=p.user_id
     WHERE p.trip_id=$1 AND p.status='ready' AND p.kind='photo' ORDER BY p.ts`, [tripId]);
  const excluded = new Set(excludedPhotoIds.map(Number));
  return {
    trip: { name: trip.name, start: trip.start_date, end: trip.end_date },
    entries: entries.map(e => ({ id: Number(e.id), ts: e.ts, author: e.author,
      place: e.place_name, text: e.text })),
    photos: photos.filter(p => !excluded.has(Number(p.id))).map(p => ({
      id: Number(p.id), ts: p.ts, author: p.author, place: p.place_name,
      orientation: p.width > p.height ? "landscape" : p.width < p.height ? "portrait" : "square",
      attachedToEntry: p.entry_id ? Number(p.entry_id) : null,
      ...(p.quality != null ? { quality: p.quality } : {}),
      ...(p.vision_tags?.length ? { tags: p.vision_tags } : {}),
      ...(p.dup_group ? { dupGroup: p.dup_group } : {})
    })),
    excludedPhotoIds: [...excluded]
  };
}

// Defensive JSON extraction for model output (real models occasionally add
// prose, fences, or stray control characters around the JSON body).
export function parseModelJson(raw) {
  const attempts = [];
  const stripped = String(raw || "").replace(/```json|```/g, "").trim();
  attempts.push(stripped);
  const a = stripped.indexOf("{"), b = stripped.lastIndexOf("}");
  if (a >= 0 && b > a) attempts.push(stripped.slice(a, b + 1));
  // control chars inside strings are the most common breakage from models
  if (a >= 0 && b > a)
    attempts.push(stripped.slice(a, b + 1)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " "));
  let lastErr;
  for (const t of attempts) {
    try { return JSON.parse(t); } catch (e) { lastErr = e; }
  }
  throw new Error(`The model returned invalid JSON (${lastErr.message}).`);
}

async function tripPhotoRows(tripId) {
  return q("SELECT id FROM photos WHERE trip_id=$1 AND status='ready' AND kind='photo'", [tripId]);
}

async function saveRevision(draftId, spec, source, note) {
  await q(
    `INSERT INTO book_draft_revisions (draft_id, spec, source, note)
     VALUES ($1,$2,$3,$4)`, [draftId, JSON.stringify(spec), source, note || null]);
  await q(
    `DELETE FROM book_draft_revisions WHERE draft_id=$1 AND id NOT IN
       (SELECT id FROM book_draft_revisions WHERE draft_id=$1 ORDER BY id DESC LIMIT 20)`,
    [draftId]);
}

export async function getOrNullDraft(tripId) {
  const [d] = await q("SELECT * FROM book_drafts WHERE trip_id=$1", [tripId]);
  return d || null;
}

// Full (re)generation into the draft. Fire-and-forget; poll draft.status.
export async function generateDraft(userId, tripId, mode) {
  const existing = await getOrNullDraft(tripId);
  let draftId = existing?.id;
  const keepExcluded = existing?.spec?.excludedPhotoIds || [];
  if (existing) {
    await saveRevision(draftId, existing.spec, "generate", "before regeneration");
    await q("UPDATE book_drafts SET status='generating', error=NULL, mode=$2 WHERE id=$1",
      [draftId, mode]);
  } else {
    const [row] = await q(
      `INSERT INTO book_drafts (trip_id, spec, mode, status)
       VALUES ($1,'{}'::jsonb,$2,'generating') RETURNING id`, [tripId, mode]);
    draftId = row.id;
  }
  try {
    const s = await settingsFor(userId);
    const corpus = await buildCorpus(tripId, keepExcluded);
    const system = await assembleSystem(userId, "narrative", { mode });
    const curation = `\nCuration level: ${CURATION_TEXT[s.curation_level] || CURATION_TEXT.balanced}` +
      `\nWhere dupGroup is present, use at most one photo per group.`;
    // one automatic retry on malformed JSON before surfacing an error
    let parsed, res;
    for (let attempt = 1; ; attempt++) {
      res = await complete(userId, "narrative", {
        system: system + curation,
        messages: [{ role: "user", content: JSON.stringify(corpus) }]
      });
      try { parsed = parseModelJson(res.text); break; }
      catch (e) { if (attempt >= 2) throw e; }
    }
    let spec = ensureV2(parsed);
    spec.excludedPhotoIds = keepExcluded.map(Number);
    spec = repairSpec(spec, await tripPhotoRows(tripId));
    await q(
      `UPDATE book_drafts SET spec=$1, status='idle', error=NULL, updated_at=now() WHERE id=$2`,
      [JSON.stringify(spec), draftId]);
    await saveRevision(draftId, spec,
      "generate", `${mode} generation${res.fallback ? " (fallback model)" : ""}`);
  } catch (e) {
    await q("UPDATE book_drafts SET status='error', error=$1 WHERE id=$2",
      [String(e.message || e).slice(0, 2000), draftId]);
  }
}

// Scoped AI edit -> apply_edits ops -> validated apply -> revision.
export async function aiEdit(userId, tripId, instruction, scope = {}) {
  const draft = await getOrNullDraft(tripId);
  if (!draft) throw new Error("No draft yet. Generate the book first.");
  const spec = ensureV2(draft.spec);
  const corpus = await buildCorpus(tripId, spec.excludedPhotoIds);
  const used = usedPhotoIds(spec);
  const manifest = corpus.photos.map(p => ({ ...p,
    inBook: used.has(p.id) ? used.get(p.id) : null }));

  let context;
  if (scope.pageId) {
    const ch = spec.chapters.find(c => c.pages.some(p => p.id === scope.pageId));
    context = { scope: "page", page: ch?.pages.find(p => p.id === scope.pageId),
      chapter: ch && { id: ch.id, title: ch.title, narrative: ch.narrative } };
  } else if (scope.chapterId) {
    context = { scope: "chapter", chapter: spec.chapters.find(c => c.id === scope.chapterId) };
  } else {
    context = { scope: "book", spec };
  }

  const system = await assembleSystem(userId, "page_edit", { mode: draft.mode }) +
    (draft.mode === "curated"
      ? "\nCurated mode is active: text must come from the provided entries."
      : "");
  const res = await complete(userId, "page_edit", {
    system,
    tools: [APPLY_EDITS_TOOL],
    messages: [{ role: "user", content: JSON.stringify({
      instruction, context, photoManifest: manifest,
      entries: corpus.entries, excludedPhotoIds: spec.excludedPhotoIds }) }]
  });
  if (!res.toolCall || res.toolCall.name !== "apply_edits")
    throw new Error("The model did not return edits. Try rephrasing.");

  const { spec: next, applied, rejected } =
    applyOps(spec, res.toolCall.input.ops, await tripPhotoRows(tripId));
  await saveRevision(draft.id, spec, "ai-edit", instruction.slice(0, 300));
  await q("UPDATE book_drafts SET spec=$1, updated_at=now() WHERE id=$2",
    [JSON.stringify(next), draft.id]);
  return { summary: res.toolCall.input.summary, applied: applied.length,
    rejected, fallback: !!res.fallback };
}

// Manual save from the editor.
export async function saveDraftSpec(tripId, spec, cutRevision) {
  const draft = await getOrNullDraft(tripId);
  if (!draft) throw new Error("No draft exists");
  if (cutRevision) await saveRevision(draft.id, draft.spec, "manual", "manual edits");
  await q("UPDATE book_drafts SET spec=$1, updated_at=now() WHERE id=$2",
    [JSON.stringify(spec), draft.id]);
  return draft.id;
}

// ---- Vision scoring (best pictures) ----------------------------------------
const scoreProgress = new Map(); // userId -> {done,total,running}
export function scoringProgress(userId) {
  return scoreProgress.get(String(userId)) || { done: 0, total: 0, running: false };
}

export async function scoreUserPhotos(userId) {
  const key = String(userId);
  if (scoreProgress.get(key)?.running) return;
  const rows = await q(
    `SELECT DISTINCT p.id, p.preview_key, p.ts, p.place_name
     FROM photos p JOIN trip_members m ON m.trip_id=p.trip_id AND m.user_id=$1
     WHERE p.status='ready' AND p.kind='photo' AND p.quality IS NULL`, [userId]);
  scoreProgress.set(key, { done: 0, total: rows.length, running: true });
  const system = await assembleSystem(userId, "vision_curation");
  try {
    for (const p of rows) {
      try {
        const img = await getObjectBuffer(p.preview_key);
        const res = await complete(userId, "vision_curation", {
          maxTokens: 300, system,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/webp",
              data: img.toString("base64") } },
            { type: "text", text: `Taken ${p.ts}${p.place_name ? " at " + p.place_name : ""}.` }
          ] }]
        });
        const j = parseModelJson(res.text);
        await q("UPDATE photos SET quality=$2, vision_tags=$3 WHERE id=$1",
          [p.id, Math.max(0, Math.min(100, j.quality | 0)), (j.tags || []).slice(0, 6)]);
      } catch { /* skip photo, continue */ }
      const st = scoreProgress.get(key); st.done += 1;
    }
    // dup grouping: same owner, same place, within 3 minutes (metadata clustering)
    await q(`
      WITH g AS (
        SELECT id, 'dg_' || user_id || '_' || trip_id || '_' ||
          floor(extract(epoch FROM ts) / 180)::text ||
          '_' || coalesce(place_name,'') AS grp,
          count(*) OVER (PARTITION BY user_id, trip_id,
            floor(extract(epoch FROM ts) / 180), coalesce(place_name,'')) AS n
        FROM photos WHERE status='ready' AND kind='photo') 
      UPDATE photos SET dup_group = CASE WHEN g.n > 1 THEN g.grp ELSE NULL END
      FROM g WHERE photos.id = g.id`);
  } finally {
    const st = scoreProgress.get(key); if (st) st.running = false;
  }
}

// ---- Transcribe polish ------------------------------------------------------
export async function polishText(userId, text) {
  const system = await assembleSystem(userId, "transcribe_polish");
  const res = await complete(userId, "transcribe_polish", {
    maxTokens: 2000, system, messages: [{ role: "user", content: text }] });
  return res.text.trim() || text;
}
