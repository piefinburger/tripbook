# SPEC-WYSIWYG-EDITOR — Visual page editor

Status: **IMPLEMENTING PHASE 1** (2026-07-24)

Replaces the current card-based `PageCard` UI with a true WYSIWYG canvas
editor: each page renders at scale using the same CSS Grid layouts as the PDF
renderer, and is directly editable via drag-and-drop, template switching, and
in-place text editing.

---

## Locked decisions

**D1 — Photo crop: CSS objectPosition + scale (Option A).**
Stored per photo per page as `photoStyles: { "[photoId]": { objectPosition: "50% 30%", scale: 1.0 } }`.
Renders as `object-position` + `transform: scale(N)` on the `<img>`.
Headless Chromium supports both, so preview and PDF match exactly.
Phase 1 carries the storage format; Phase 2 adds the crop UI.

**D2 — Text blocks: full free-form positioned text.**
Stored as `textBlocks: [{ id, text, x, y, w, fontSize, fontFamily, color, align }]`
on each page. Coordinates are percentages of the page size (0–100), so they
scale correctly at every zoom level. Phase 3 adds the text UI.

**D3 — Drag-and-drop: desktop-first, iOS tap-to-select fallback.**
On desktop (pointer device): HTML5 drag from sidebar photo → drop onto slot.
On iOS (touch device): tap a photo slot to select it (ring highlight), then
tap a sidebar photo to place it. No touch-drag polyfill.

**D4 — Build in three PRs (phases).**
- Phase 1 (this PR): Visual canvas, template picker, photo drag/drop, slot
  management.
- Phase 2: Per-photo zoom/crop controls (objectPosition slider + drag-to-pan).
- Phase 3: Text block placement, drag, and formatting toolbar.

**D5 — Page canvas scale.**
The page is 816px × 816px (8.5in at 96 dpi). In the editor the active page
canvas targets ~600px wide; thumbnail canvases target ~220px wide.
Implemented via `transform: scale(N)` + `transform-origin: top left` inside a
wrapper div that has `aspect-ratio: 1 / 1` and `overflow: hidden`.
Scale is computed via a `ResizeObserver` on the wrapper.

**D6 — Template picker.**
A horizontal strip of 15 visual thumbnail diagrams (pure CSS, no SVG),
displayed below the active page canvas. Clicking a thumbnail switches the page
template. If the new template requires fewer photos than are currently placed,
excess photos are dropped from the end of the slot list (not moved to excluded).
If it requires more, empty slots appear and wait for drops.

**D7 — Photo slot interaction.**
Each photo slot within the canvas is an interactive `<div>` that:
- Shows the photo via `<img object-fit: cover>`
- On drag-over: dashed border highlight
- On click (iOS / no-drag): marks the slot as "awaiting photo" (pulsing border)
- Shows an ×-remove button on hover (desktop) / always (touch)
- Empty slots show a dashed placeholder with a + icon

**D8 — Editor layout: two-column preserved.**
Phase 1 keeps the existing two-column layout (pages left, sidebar right).
- Unfocused pages: ~220px thumbnail canvas + chapter/caption text below
- Focused (selected) page: ~600px canvas + template picker strip below
- Page focus replaces the current "selected page" concept

**D9 — Spec compatibility.**
`photoStyles` and `textBlocks` are optional fields; their absence means no
crop offset and no text blocks. `ensureV2` and `repairSpec` ignore unknown
keys (they only validate `template` and `photoIds`). No migration needed for
existing drafts.

**D10 — Saving.**
The autosave mechanism (1.5s debounce → PUT /api/trips/[id]/draft) is
unchanged. Spec mutations from the canvas editor (photo placed, photo removed,
template switched) go through the existing `mutate(fn)` path.

---

## Spec shape additions (Phase 1 storage, UI in Phase 2/3)

```json
{
  "id": "pg_x",
  "template": "hero-left",
  "photoIds": [123, 456],
  "photoStyles": {
    "123": { "objectPosition": "50% 30%", "scale": 1.2 }
  },
  "textBlocks": [
    {
      "id": "tb_x",
      "text": "Caption text",
      "x": 5, "y": 80, "w": 60,
      "fontSize": 12,
      "fontFamily": "Georgia",
      "color": "#14343b",
      "align": "left"
    }
  ],
  "caption": "",
  "text": "",
  "pinned": false
}
```

---

## Template picker thumbnails

Each thumbnail is a miniature CSS-only diagram (16×16pt boxes):

| template | diagram |
|---|---|
| full-bleed | solid fill rectangle |
| hero-left | wide left + narrow right |
| hero-right | narrow left + wide right |
| hero-top | tall top + short bottom |
| two-equal | two equal columns |
| three-banner | wide top + two below |
| three-sidebar | wide left + two stacked right |
| panoramic-strip | three horizontal rows |
| four-grid | 2×2 |
| four-asymmetric | large top-left + three smaller |
| five-mosaic | wide left + 2×2 right |
| six-grid | 3×2 |
| photo-text | photo top 60% + text stripe |
| text-photo | text left 45% + photo right |
| text-only | horizontal lines (text icon) |

---

## Phase 1 component map

| Component | What it does |
|---|---|
| `PageCanvas` | Scaled interactive page canvas; slots are drag targets |
| `PhotoSlot` | Individual interactive photo slot inside the canvas |
| `TemplatePicker` | Horizontal strip of template thumbnail buttons |
| `BookEditor` | Updated to use PageCanvas + TemplatePicker; sidebar photos get `draggable` |

---

## Out of scope for Phase 1

- Zoom/crop controls (Phase 2)
- Text block creation, positioning, formatting (Phase 3)
- Undo for individual slot changes (covered by autosave + revision history)
- Reordering photos within a multi-slot page (drag between slots on same page)
