// Layout spec v2 engine (SPEC-BOOK-EDITOR D3/D5): lazy v1->v2 upgrade,
// structural validation, and the apply_edits operation set with all-or-
// nothing per op (invalid ops are dropped and reported; valid ops apply).
import crypto from "crypto";

const TPL_COUNT = {
  "full-bleed": 1,
  "hero-left": 2, "hero-right": 2, "hero-top": 2, "two-equal": 2,
  "three-banner": 3, "three-sidebar": 3, "panoramic-strip": 3,
  "four-grid": 4, "four-asymmetric": 4,
  "five-mosaic": 5,
  "six-grid": 6,
  "photo-text": 1, "text-photo": 1, "text-only": 0,
  // legacy aliases (still valid, render as their modern equivalents)
  "two-up": 2, "three-grid": 3,
};
const uid = (p) => `${p}_${crypto.randomBytes(4).toString("hex")}`;

export function ensureV2(spec) {
  const s = JSON.parse(JSON.stringify(spec || {}));
  s.version = 2;
  s.title ??= "Untitled Book"; s.subtitle ??= "";
  s.chapters = (s.chapters || []).map(ch => ({
    id: ch.id || uid("ch"), title: ch.title || "", narrative: ch.narrative || "",
    pages: (ch.pages || []).map(pg => ({
      id: pg.id || uid("pg"), template: pg.template || "text-only",
      photoIds: pg.photoIds || [], caption: pg.caption || "",
      text: pg.text || "", pinned: !!pg.pinned,
      photoStyles: pg.photoStyles || {},
      textBlocks: pg.textBlocks || [],
      layoutOverrides: pg.layoutOverrides || {},
    }))
  }));
  s.excludedPhotoIds = s.excludedPhotoIds || [];
  return s;
}

export function usedPhotoIds(spec) {
  const used = new Map(); // photoId -> pageId
  for (const ch of spec.chapters) for (const pg of ch.pages)
    for (const id of pg.photoIds) used.set(Number(id), pg.id);
  return used;
}

function findChapter(spec, chapterId) { return spec.chapters.find(c => c.id === chapterId); }
function findPage(spec) {
  const idx = {};
  for (const ch of spec.chapters) for (const pg of ch.pages) idx[pg.id] = { ch, pg };
  return idx;
}

function validPage(page, validIds, excluded, usedElsewhere) {
  const t = page.template;
  if (!(t in TPL_COUNT)) return `unknown template ${t}`;
  const ids = (page.photoIds || []).map(Number);
  // Allow partial fills (fewer photos than slots) — editor may have empty slots.
  // Over-filled pages are still rejected since the renderer can't handle them.
  if (ids.length > TPL_COUNT[t]) return `${t} takes at most ${TPL_COUNT[t]} photos, got ${ids.length}`;
  for (const id of ids) {
    if (!validIds.has(id)) return `photo ${id} does not exist or is not ready`;
    if (excluded.has(id)) return `photo ${id} is excluded`;
    if (usedElsewhere.has(id)) return `photo ${id} already used on page ${usedElsewhere.get(id)}`;
  }
  return null;
}

// Whole-spec validation used on PUT draft and after generation.
export function validateSpec(spec, photoRows) {
  const validIds = new Set(photoRows.map(p => Number(p.id)));
  const errors = [];
  const excluded = new Set((spec.excludedPhotoIds || []).map(Number));
  const seen = new Map();
  for (const ch of spec.chapters) {
    for (const pg of ch.pages) {
      const err = validPage(pg, validIds, excluded, seen);
      if (err) errors.push(`page ${pg.id}: ${err}`);
      else for (const id of pg.photoIds.map(Number)) seen.set(id, pg.id);
    }
  }
  return errors;
}

// Drops photos that no longer exist / are excluded, fixes templates to match
// remaining photo counts, removes empty photo pages. Used to repair AI output.
export function repairSpec(spec, photoRows) {
  const validIds = new Set(photoRows.map(p => Number(p.id)));
  const excluded = new Set((spec.excludedPhotoIds || []).map(Number));
  const seen = new Set();
  // Default template by photo count (D3 — simplest/safest at each count)
  const byCount = { 0: "text-only", 1: "full-bleed", 2: "two-equal", 3: "three-banner", 4: "four-grid", 5: "five-mosaic", 6: "six-grid" };
  for (const ch of spec.chapters) {
    for (const pg of ch.pages) {
      pg.photoIds = (pg.photoIds || []).map(Number)
        .filter(id => validIds.has(id) && !excluded.has(id) && !seen.has(id));
      pg.photoIds.forEach(id => seen.add(id));
      const n = pg.photoIds.length;
      if (n === 0) pg.template = "text-only";
      else if ((pg.template === "photo-text" || pg.template === "text-photo") && n === 1) { /* ok */ }
      else {
        const expected = TPL_COUNT[pg.template];
        // Only reassign template if it's unknown or over-filled; partial fills are valid
        if (expected === undefined || n > expected) pg.template = byCount[Math.min(n, 6)] || "six-grid";
      }
      pg.photoIds = pg.photoIds.slice(0, TPL_COUNT[pg.template]);
    }
    ch.pages = ch.pages.filter(pg => pg.template !== "text-only" || (pg.text || "").trim());
  }
  spec.chapters = spec.chapters.filter(ch => ch.pages.length || (ch.narrative || "").trim());
  return spec;
}

export const APPLY_EDITS_TOOL = {
  name: "apply_edits",
  description: "Apply a batch of edits to the photo book layout.",
  input_schema: {
    type: "object",
    required: ["ops", "summary"],
    properties: {
      summary: { type: "string", description: "One sentence describing the edit, shown to the user." },
      ops: { type: "array", items: { type: "object",
        required: ["op"],
        properties: {
          op: { type: "string", enum: ["replace_page","insert_page","remove_page","move_page",
            "set_chapter","insert_chapter","remove_chapter","set_meta",
            "exclude_photos","include_photos"] },
          pageId: { type: "string" }, chapterId: { type: "string" },
          afterPageId: { type: ["string","null"] }, afterChapterId: { type: ["string","null"] },
          page: { type: "object" }, chapter: { type: "object" },
          title: { type: "string" }, subtitle: { type: "string" }, narrative: { type: "string" },
          photoIds: { type: "array", items: { type: "integer" } }
        } } }
    }
  }
};

// Applies ops one at a time against a working copy. Returns the new spec,
// applied ops, and rejected ops with reasons.
export function applyOps(spec0, ops, photoRows) {
  let spec = ensureV2(spec0);
  const validIds = new Set(photoRows.map(p => Number(p.id)));
  const applied = [], rejected = [];

  const normPage = (p) => ({ id: p.id || uid("pg"), template: p.template,
    photoIds: (p.photoIds || []).map(Number), caption: p.caption || "",
    text: p.text || "", pinned: !!p.pinned });

  for (const op of ops || []) {
    const excluded = new Set(spec.excludedPhotoIds.map(Number));
    const pages = findPage(spec);
    const fail = (why) => rejected.push({ op, why });
    try {
      switch (op.op) {
        case "set_meta": {
          if (op.title !== undefined) spec.title = String(op.title);
          if (op.subtitle !== undefined) spec.subtitle = String(op.subtitle);
          applied.push(op); break;
        }
        case "set_chapter": {
          const ch = findChapter(spec, op.chapterId);
          if (!ch) { fail("chapter not found"); break; }
          if (op.title !== undefined) ch.title = String(op.title);
          if (op.narrative !== undefined) ch.narrative = String(op.narrative);
          applied.push(op); break;
        }
        case "insert_chapter": {
          const ch = { id: uid("ch"), title: op.chapter?.title || "",
            narrative: op.chapter?.narrative || "",
            pages: (op.chapter?.pages || []).map(normPage) };
          const used = usedPhotoIds(spec);
          let bad = null;
          for (const pg of ch.pages) {
            bad = validPage(pg, validIds, excluded, used);
            if (bad) break;
            pg.photoIds.forEach(id => used.set(id, pg.id));
          }
          if (bad) { fail(bad); break; }
          const at = op.afterChapterId
            ? spec.chapters.findIndex(c => c.id === op.afterChapterId) + 1 : spec.chapters.length;
          spec.chapters.splice(at < 1 ? spec.chapters.length : at, 0, ch);
          applied.push(op); break;
        }
        case "remove_chapter": {
          const i = spec.chapters.findIndex(c => c.id === op.chapterId);
          if (i < 0) { fail("chapter not found"); break; }
          if (spec.chapters[i].pages.some(p => p.pinned)) { fail("chapter contains pinned pages"); break; }
          spec.chapters.splice(i, 1); applied.push(op); break;
        }
        case "replace_page": {
          const hit = pages[op.pageId];
          if (!hit) { fail("page not found"); break; }
          if (hit.pg.pinned && !op.page?.pinned === false) { /* allow unpin via manual UI only */ }
          if (hit.pg.pinned) { fail("page is pinned"); break; }
          const next = normPage({ ...op.page, id: op.pageId });
          const used = usedPhotoIds(spec);
          hit.pg.photoIds.forEach(id => used.delete(Number(id))); // freeing its own photos
          const bad = validPage(next, validIds, excluded, used);
          if (bad) { fail(bad); break; }
          Object.assign(hit.pg, next); applied.push(op); break;
        }
        case "insert_page": {
          const ch = findChapter(spec, op.chapterId);
          if (!ch) { fail("chapter not found"); break; }
          const next = normPage(op.page || {});
          const bad = validPage(next, validIds, excluded, usedPhotoIds(spec));
          if (bad) { fail(bad); break; }
          const at = op.afterPageId ? ch.pages.findIndex(p => p.id === op.afterPageId) + 1 : ch.pages.length;
          ch.pages.splice(at < 1 ? ch.pages.length : at, 0, next);
          applied.push(op); break;
        }
        case "remove_page": {
          const hit = pages[op.pageId];
          if (!hit) { fail("page not found"); break; }
          if (hit.pg.pinned) { fail("page is pinned"); break; }
          hit.ch.pages = hit.ch.pages.filter(p => p.id !== op.pageId);
          applied.push(op); break;
        }
        case "move_page": {
          const hit = pages[op.pageId];
          const dest = findChapter(spec, op.chapterId || hit?.ch.id);
          if (!hit || !dest) { fail("page or chapter not found"); break; }
          hit.ch.pages = hit.ch.pages.filter(p => p.id !== op.pageId);
          const at = op.afterPageId ? dest.pages.findIndex(p => p.id === op.afterPageId) + 1 : dest.pages.length;
          dest.pages.splice(at < 1 ? dest.pages.length : at, 0, hit.pg);
          applied.push(op); break;
        }
        case "exclude_photos": {
          const ids = (op.photoIds || []).map(Number).filter(id => validIds.has(id));
          if (!ids.length) { fail("no valid photoIds"); break; }
          const used = usedPhotoIds(spec);
          for (const id of ids) { // pull off pages first
            const pgId = used.get(id);
            if (pgId) {
              const hit = findPage(spec)[pgId];
              if (hit.pg.pinned) continue; // never touch pinned
              hit.pg.photoIds = hit.pg.photoIds.filter(x => Number(x) !== id);
              const byCount = { 0: "text-only", 1: "full-bleed", 2: "two-equal", 3: "three-banner", 4: "four-grid", 5: "five-mosaic", 6: "six-grid" };
              const n = hit.pg.photoIds.length;
              if ((hit.pg.template !== "photo-text" && hit.pg.template !== "text-photo") || n === 0)
                hit.pg.template = byCount[Math.min(n, 6)] || "six-grid";
            }
            if (!spec.excludedPhotoIds.map(Number).includes(id)) spec.excludedPhotoIds.push(id);
          }
          applied.push(op); break;
        }
        case "include_photos": {
          const ids = new Set((op.photoIds || []).map(Number));
          spec.excludedPhotoIds = spec.excludedPhotoIds.map(Number).filter(id => !ids.has(id));
          applied.push(op); break;
        }
        default: fail("unknown op");
      }
    } catch (e) { fail(String(e.message || e)); }
  }
  // drop photo-less pages the ops may have created via exclusion
  for (const ch of spec.chapters)
    ch.pages = ch.pages.filter(pg => pg.template !== "text-only" || (pg.text || "").trim() || pg.pinned);
  return { spec, applied, rejected };
}
