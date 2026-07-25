// Converts a grid-template page into a freestyle page with absolutely-
// positioned elements. Pure function — no DOM dependency.

const uid = () => "el_" + Math.random().toString(16).slice(2, 10);

// Grid geometry for each template: default fr strings and how slots map to
// grid cells. Each slot has { col, row, colSpan, rowSpan } in 0-based grid
// indices. For templates with only columns or only rows, the missing axis
// defaults to a single track.
const GRID_DEFS = {
  "full-bleed":     { cols: null, rows: null, slots: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }] },
  "photo-text":     { cols: null, rows: "3fr 2fr", slots: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }], textRow: 1 },
  "text-photo":     { cols: "9fr 11fr", rows: null, slots: [{ col: 1, row: 0, colSpan: 1, rowSpan: 1 }], textCol: 0 },
  "text-only":      { cols: null, rows: null, slots: [] },
  "two-equal":      { cols: "1fr 1fr", rows: null, slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
  ]},
  "two-up":         { cols: "1fr 1fr", rows: null, slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
  ]},
  "hero-left":      { cols: "7fr 3fr", rows: null, slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
  ]},
  "hero-right":     { cols: "3fr 7fr", rows: null, slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
  ]},
  "hero-top":       { cols: null, rows: "13fr 7fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 0, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "three-banner":   { cols: "1fr 1fr", rows: "3fr 2fr", slots: [
    { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "three-grid":     { cols: "1fr 1fr", rows: "3fr 2fr", slots: [
    { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "three-sidebar":  { cols: "3fr 2fr", rows: "1fr 1fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 2 },
    { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "panoramic-strip": { cols: null, rows: "1fr 1fr 1fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 2, colSpan: 1, rowSpan: 1 }
  ]},
  "four-grid":      { cols: "1fr 1fr", rows: "1fr 1fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "four-asymmetric": { cols: "3fr 2fr", rows: "3fr 2fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
  "five-mosaic":    { cols: "3fr 2fr", rows: "1fr 1fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 2 },
    { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, // top-right quadrant split further
    // five-mosaic right side is a 2×2 sub-grid; approximate as 4 equal cells
  ]},
  "six-grid":       { cols: "1fr 1fr 1fr", rows: "1fr 1fr", slots: [
    { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 2, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    { col: 2, row: 1, colSpan: 1, rowSpan: 1 }
  ]},
};

// Parse "7fr 3fr" → [7, 3]
function parseFr(str) {
  if (!str) return [1];
  return str.trim().split(/\s+/).map(s => parseFloat(s) || 1);
}

// Convert fr values to percentage offsets: [7, 3] → [0, 70, 100]
function frToPercents(frs) {
  const total = frs.reduce((a, b) => a + b, 0);
  const pcts = [0];
  let acc = 0;
  for (const f of frs) {
    acc += (f / total) * 100;
    pcts.push(acc);
  }
  return pcts;
}

// Compute { x, y, w, h } in percentages from grid cell assignment.
function cellRect(slot, colPcts, rowPcts) {
  const x = colPcts[slot.col];
  const y = rowPcts[slot.row];
  const w = colPcts[slot.col + slot.colSpan] - x;
  const h = rowPcts[slot.row + slot.rowSpan] - y;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
           w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}

export function templateToFreestyle(pg) {
  const def = GRID_DEFS[pg.template];
  if (!def) return pg; // unknown template, return as-is

  const ov = pg.layoutOverrides || {};
  const colFrs = parseFr(ov.columns || def.cols);
  const rowFrs = parseFr(ov.rows || def.rows);
  const colPcts = frToPercents(colFrs);
  const rowPcts = frToPercents(rowFrs);

  const elements = [];
  const ids = pg.photoIds || [];
  const styles = pg.photoStyles || {};

  // Special case: five-mosaic has a nested sub-grid for the right side
  if (pg.template === "five-mosaic") {
    // Left photo: full height, 60% width (3fr of 3fr+2fr)
    const leftW = colPcts[1];
    if (ids[0]) {
      elements.push({ id: uid(), type: "photo", x: 0, y: 0, w: Math.round(leftW * 10) / 10, h: 100,
        zIndex: 1, photoId: Number(ids[0]), photoStyle: styles[ids[0]] || {} });
    }
    // Right side: 2×2 grid in the remaining space
    const rightX = leftW;
    const rightW = 100 - leftW;
    const halfW = rightW / 2;
    for (let i = 1; i < Math.min(ids.length, 5); i++) {
      const col = (i - 1) % 2;
      const row = Math.floor((i - 1) / 2);
      elements.push({ id: uid(), type: "photo",
        x: Math.round((rightX + col * halfW) * 10) / 10,
        y: Math.round(row * 50 * 10) / 10,
        w: Math.round(halfW * 10) / 10, h: 50,
        zIndex: i + 1, photoId: Number(ids[i]), photoStyle: styles[ids[i]] || {} });
    }
  } else {
    // Standard grid templates
    for (let i = 0; i < def.slots.length && i < ids.length; i++) {
      const rect = cellRect(def.slots[i], colPcts, rowPcts);
      elements.push({ id: uid(), type: "photo", ...rect,
        zIndex: i + 1, photoId: Number(ids[i]), photoStyle: styles[ids[i]] || {} });
    }
  }

  // Convert text content to a text element
  const text = pg.text || pg.caption || "";
  if (text && def.textRow !== undefined) {
    const rect = cellRect(
      { col: 0, row: def.textRow, colSpan: colFrs.length, rowSpan: 1 },
      colPcts, rowPcts
    );
    elements.push({ id: uid(), type: "text", ...rect,
      zIndex: elements.length + 1, text,
      fontSize: 12, color: "#14343b", fontWeight: "normal", align: "left" });
  } else if (text && def.textCol !== undefined) {
    const rect = cellRect(
      { col: def.textCol, row: 0, colSpan: 1, rowSpan: rowFrs.length },
      colPcts, rowPcts
    );
    elements.push({ id: uid(), type: "text", ...rect,
      zIndex: elements.length + 1, text,
      fontSize: 12, color: "#14343b", fontWeight: "normal", align: "left" });
  } else if (text && pg.template === "text-only") {
    elements.push({ id: uid(), type: "text", x: 5, y: 5, w: 90, h: 90,
      zIndex: 1, text, fontSize: 12, color: "#14343b", fontWeight: "normal", align: "left" });
  }

  return {
    ...pg,
    template: "freestyle",
    elements,
    // Clear grid-specific fields
    photoIds: [],
    photoStyles: {},
    layoutOverrides: {},
  };
}
