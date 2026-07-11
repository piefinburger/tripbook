// Prompt architecture (SPEC-AI-SETTINGS D5/D6): code-owned scaffolds bracket
// user-editable steering blocks. Scaffolds carry the output contract and hard
// rules; steering carries voice and taste. Scaffold always wins by
// construction: it restates the contract after the steering text.
import { q } from "./db";

export const TASKS = ["narrative", "page_edit", "vision_curation", "transcribe_polish"];

export const SPEC_SHAPE = `{
  "version": 2,
  "title": "book title", "subtitle": "date range or tagline",
  "chapters": [{ "id": "ch_x", "title": "...", "narrative": "...",
    "pages": [{ "id": "pg_x",
      "template": "full-bleed | two-up | three-grid | photo-text | text-only",
      "photoIds": [123], "caption": "", "text": "", "pinned": false }] }],
  "excludedPhotoIds": []
}`;

export const DEFAULT_BLOCKS = {
  narrative: {
    voice: `Warm, concise family scrapbook voice. Ground every sentence in the
notes and photo metadata provided; never fabricate events. Chapter narratives
are 2 to 4 sentences.`,
    curation: `Select for the story, not for completeness. Prefer one strong
photo over near duplicates (same author, same place, within ~3 minutes, or
sharing a dupGroup). A week-long trip should land between 20 and 40 pages.`,
    captions: `Captions are short (12 words or fewer), specific, and never
restate the narrative. Prefer a family member's own phrasing when a note
matches the photo.`
  },
  page_edit: {
    voice: `Match the voice already present in the book. Keep edits minimal
and targeted to the instruction; do not rewrite what was not asked about.`,
    captions: `Captions are short (12 words or fewer) and specific.`
  },
  vision_curation: {
    taste: `Reward: people mid-moment, genuine expressions, strong light,
clear subject. Penalize: blur, closed eyes, clutter, accidental shots,
near-black or blown-out frames.`
  },
  transcribe_polish: {
    voice: `Fix dictation artifacts, punctuation, and obvious typos only.
Preserve the writer's word choice, rhythm, and meaning exactly. Never add
content or embellish.`
  }
};

const SCAFFOLD_HEAD = {
  narrative: (mode) => `You lay out family vacation photo books. Respond with
ONLY a JSON object matching this shape, no markdown fences, no commentary:
${SPEC_SHAPE}
Hard rules (non-negotiable, they override any styling guidance below):
- Every photoId MUST come from the provided photo list, used at most once,
  and never from excludedPhotoIds.
- Templates: full-bleed (exactly 1 photo), two-up (2), three-grid (3),
  photo-text (1 photo + text), text-only (0).
- 4 to 8 pages per chapter; chapters chronological by day or location.
- Generate "id" values as short unique strings prefixed ch_/pg_.
${mode === "curated" ? `MODE: CURATED. Use ONLY the family's own words. Never
invent narrative, feelings, or descriptions. Allowed edits: typos,
capitalization, punctuation, ordering, grouping. "narrative" must be empty
strings; captions only a member's own note text (or trimmed excerpt), or the
place name and date; chapter titles are place names or dates only. This rule
overrides everything below.` : "MODE: AUTO-NARRATIVE."}`,
  page_edit: () => `You edit one family photo book. You MUST respond by
calling the apply_edits tool exactly once with a list of operations; no prose
outside the tool call. Hard rules (non-negotiable, they override any styling
guidance below):
- photoIds must come from the provided manifests, never from excluded lists,
  and a photo may appear on only one page.
- Respect template photo counts exactly (full-bleed 1, two-up 2, three-grid 3,
  photo-text 1, text-only 0).
- Never modify pages marked pinned.
- In curated mode, any text you write must be drawn from the provided entries
  verbatim or near-verbatim; do not invent prose.`,
  vision_curation: () => `You score one vacation photo for a family photo
book. Respond with ONLY a JSON object, no fences:
{ "quality": 0-100, "tags": ["few", "words"], "description": "one sentence" }
Score relative to typical phone vacation photos.`,
  transcribe_polish: () => `You clean up one dictated journal note. Respond
with ONLY the cleaned text, nothing else. Hard rule: do not add, remove, or
reorder information.`
};

const SCAFFOLD_TAIL = {
  narrative: `Reminder: output is the single JSON object described above and
nothing else. All hard rules above override the styling guidance.`,
  page_edit: `Reminder: respond only with one apply_edits tool call. Hard
rules above override the styling guidance.`,
  vision_curation: `Reminder: output is the single JSON object only.`,
  transcribe_polish: `Reminder: output the cleaned text only.`
};

export async function getBlocks(userId, task) {
  const defaults = DEFAULT_BLOCKS[task] || {};
  const rows = await q(
    "SELECT block, content FROM prompt_overrides WHERE user_id=$1 AND task=$2",
    [userId, task]);
  const overrides = Object.fromEntries(rows.map(r => [r.block, r.content]));
  return Object.fromEntries(Object.keys(defaults).map(b =>
    [b, { content: overrides[b] ?? defaults[b], overridden: b in overrides, default: defaults[b] }]));
}

export async function assembleSystem(userId, task, opts = {}) {
  const blocks = await getBlocks(userId, task);
  const steering = Object.entries(blocks)
    .map(([name, b]) => `[Styling guidance: ${name}]\n${b.content}`).join("\n\n");
  return `${SCAFFOLD_HEAD[task](opts.mode)}\n\n${steering}\n\n${SCAFFOLD_TAIL[task]}`;
}
