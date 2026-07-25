"use client";
// WYSIWYG page canvas (SPEC-WYSIWYG-EDITOR Phase 1 + 2).
// Phase 2 adds per-photo zoom/crop via objectPosition + scale stored in
// pg.photoStyles[photoId].
import { useEffect, useRef, useState, useCallback } from "react";
import { slotImgStyle } from "@/lib/photoStyle";
import FreestyleCanvas from "@/components/FreestyleCanvas";
import CropOverlay from "@/components/CropOverlay";

const PAGE_PX = 816; // 8.5in × 96dpi

export default function PageCanvas({
  pg,
  photoById,
  focused,
  onFocus,
  onPlacePhoto,      // (slotIndex, photoId)
  onRemovePhoto,     // (slotIndex)
  onPhotoStyle,      // (photoId, style) — saves crop/zoom
  onLayoutChange,    // (columns, rows) — saves grid ratio overrides
  onCaption,
  onText,
  draggingPhotoId,
  awaitingSlot,
  onSlotClick,
  // Freestyle props
  selectedElementId,
  onSelectElement,
  onUpdateElement,
  onRemoveElement,
  onPlacePhotoInElement,
}) {
  const wrapperRef = useRef(null);
  const [canvasScale, setCanvasScale] = useState(0.27);
  const [croppingPhotoId, setCroppingPhotoId] = useState(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setCanvasScale(e.contentRect.width / PAGE_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close crop overlay when page loses focus
  useEffect(() => { if (!focused) setCroppingPhotoId(null); }, [focused]);

  // ── Freestyle delegation ──────────────────────────────────
  if (pg.template === "freestyle") {
    return (
      <div
        ref={wrapperRef}
        className={`page-canvas-wrap ${focused ? "page-canvas-focused" : ""}`}
        onClick={!focused ? onFocus : undefined}
        title={focused ? undefined : "Click to edit this page"}
      >
        <div
          className="page-canvas-inner"
          style={{ width: PAGE_PX, height: PAGE_PX, transform: `scale(${canvasScale})`, transformOrigin: "top left" }}
        >
          <FreestyleCanvas
            pg={pg}
            photoById={photoById}
            focused={focused}
            selectedElementId={selectedElementId}
            onSelectElement={onSelectElement}
            onUpdateElement={onUpdateElement}
            onRemoveElement={onRemoveElement}
            onPlacePhotoInElement={onPlacePhotoInElement}
            draggingPhotoId={draggingPhotoId}
          />
        </div>
      </div>
    );
  }

  const ids = pg.photoIds || [];
  const photoStyles = pg.photoStyles || {};
  const slotCount = TPL_SLOTS[pg.template] ?? 0;
  const slots = Array.from({ length: slotCount }, (_, i) => ids[i] ?? null);

  const renderSlots = () => slots.map((pid, i) => {
    const photo = pid ? photoById[pid] : null;
    const style = pid ? (photoStyles[pid] || {}) : {};
    return (
      <PhotoSlot
        key={i}
        photo={photo}
        photoStyle={style}
        slotIndex={i}
        awaiting={awaitingSlot === i}
        dragging={draggingPhotoId != null}
        cropping={croppingPhotoId === pid}
        focused={focused}
        onDrop={(photoId) => onPlacePhoto(i, photoId)}
        onRemove={() => onRemovePhoto(i)}
        onClick={() => {
          if (focused && photo) {
            setCroppingPhotoId(old => old === pid ? null : pid);
          } else {
            onSlotClick(i);
          }
        }}
        onStyleChange={(s) => onPhotoStyle(pid, s)}
        onCropClose={() => setCroppingPhotoId(null)}
      />
    );
  });

  const overrides = pg.layoutOverrides || {};
  const resizeCtx = focused && onLayoutChange ? {
    overrides,
    onColChange: (col) => onLayoutChange(col, overrides.rows || null),
    onRowChange: (row) => onLayoutChange(overrides.columns || null, row),
  } : null;

  const inner = renderTemplate(pg.template, renderSlots, pg, resizeCtx);

  return (
    <div
      ref={wrapperRef}
      className={`page-canvas-wrap ${focused ? "page-canvas-focused" : ""}`}
      onClick={!focused ? onFocus : undefined}
      title={focused ? undefined : "Click to edit this page"}
    >
      <div
        className="page-canvas-inner"
        style={{ width: PAGE_PX, height: PAGE_PX, transform: `scale(${canvasScale})`, transformOrigin: "top left" }}
      >
        {inner}

        {focused && pg.template !== "photo-text" && pg.template !== "text-photo" && pg.template !== "text-only" && (
          <div className="canvas-caption-bar" onClick={e => e.stopPropagation()}>
            <input
              value={pg.caption || ""}
              onChange={e => onCaption(e.target.value)}
              placeholder="Caption (optional)"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Photo slot ────────────────────────────────────────────────────────────────
function PhotoSlot({ photo, photoStyle, slotIndex, awaiting, dragging, cropping,
  focused, onDrop, onRemove, onClick, onStyleChange, onCropClose }) {
  const [over, setOver] = useState(false);

  // Use previewUrl (1600px) for the canvas display; fall back to url (640px thumb)
  const imgSrc = photo?.previewUrl || photo?.url;

  const imgStyle = slotImgStyle(photoStyle);

  return (
    <div
      className={`pg-slot ${over ? "pg-slot-over" : ""} ${awaiting ? "pg-slot-awaiting" : ""} ${!photo ? "pg-slot-empty" : ""}`}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setOver(false);
        const pid = Number(e.dataTransfer.getData("photoId"));
        if (pid) onDrop(pid);
      }}
      onClick={e => { e.stopPropagation(); onClick(); }}
    >
      {photo ? (
        <>
          <img src={imgSrc} alt="" style={imgStyle} draggable={false} />

          {/* Crop overlay — shown when this slot is clicked while focused */}
          {cropping && focused && (
            <CropOverlay
              photo={photo}
              style={photoStyle}
              onChange={onStyleChange}
              onClose={onCropClose}
            />
          )}

          {/* Crop hint button — only when focused and not already cropping */}
          {focused && !cropping && (
            <button
              className="slot-crop-btn"
              onClick={e => { e.stopPropagation(); onClick(); }}
              title="Adjust crop and zoom"
            >⤢</button>
          )}

          <button
            className="slot-remove"
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title="Remove photo"
          >×</button>
        </>
      ) : (
        <div className="slot-placeholder">
          {dragging ? "Drop here" : "+"}
        </div>
      )}
    </div>
  );
}

// slotImgStyle is imported from @/lib/photoStyle (shared with server renderer)
// CropOverlay is imported from @/components/CropOverlay (shared with FreestyleCanvas)

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Layout resize helpers ────────────────────────────────────────────────────
// Parse "7fr 3fr" → [7, 3]. toFrStr([6, 4]) → "6fr 4fr".
function parseFr(str) {
  if (!str) return [1];
  return str.trim().split(/\s+/).map(s => parseFloat(s) || 1);
}
function toFrStr(arr) {
  return arr.map(v => `${Math.round(v * 10) / 10}fr`).join(" ");
}
// Position (0–1) of the first divider in a fr string.
function trackFraction(frStr) {
  const parts = parseFr(frStr);
  const total = parts.reduce((a, b) => a + b, 0);
  return total > 0 ? parts[0] / total : 0.5;
}

// ── ResizeHandle ─────────────────────────────────────────────────────────────
// A draggable bar positioned over the gap between grid tracks.
// containerRef must point to the grid container (for getBoundingClientRect).
function ResizeHandle({ axis, fraction, containerRef, onFraction }) {
  const isDragging = useRef(false);

  const onPointerDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const f = axis === "col"
      ? clamp((e.clientX - rect.left) / rect.width, 0.05, 0.95)
      : clamp((e.clientY - rect.top) / rect.height, 0.05, 0.95);
    onFraction(f);
  };
  const onPointerUp = () => { isDragging.current = false; };

  return (
    <div
      className={`resize-handle resize-handle-${axis}`}
      style={axis === "col" ? { left: `${fraction * 100}%` } : { top: `${fraction * 100}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// ── ResizableGrid ────────────────────────────────────────────────────────────
// Wraps a template grid container and overlays resize handles when focused.
// defaultCol / defaultRow are the template's built-in fr strings.
// overrideCol / overrideRow come from pg.layoutOverrides.
function ResizableGrid({ gridClass, defaultCol, defaultRow, overrideCol, overrideRow,
  onColChange, onRowChange, children }) {
  const ref = useRef(null);
  const style = { height: "100%", position: "relative" };
  if (defaultCol) style.gridTemplateColumns = overrideCol || defaultCol;
  if (defaultRow) style.gridTemplateRows = overrideRow || defaultRow;

  return (
    <div ref={ref} className={`${gridClass} bk-grid`} style={style}>
      {children}
      {defaultCol && onColChange && (
        <ResizeHandle axis="col"
          fraction={trackFraction(overrideCol || defaultCol)}
          containerRef={ref}
          onFraction={f => {
            const total = parseFr(overrideCol || defaultCol).reduce((a, b) => a + b, 0);
            onColChange(toFrStr([f * total, (1 - f) * total]));
          }} />
      )}
      {defaultRow && onRowChange && (
        <ResizeHandle axis="row"
          fraction={trackFraction(overrideRow || defaultRow)}
          containerRef={ref}
          onFraction={f => {
            const total = parseFr(overrideRow || defaultRow).reduce((a, b) => a + b, 0);
            onRowChange(toFrStr([f * total, (1 - f) * total]));
          }} />
      )}
    </div>
  );
}

// ── Template → DOM structure ──────────────────────────────────────────────────
const TPL_SLOTS = {
  "full-bleed": 1, "hero-left": 2, "hero-right": 2, "hero-top": 2, "two-equal": 2,
  "three-banner": 3, "three-sidebar": 3, "panoramic-strip": 3,
  "four-grid": 4, "four-asymmetric": 4, "five-mosaic": 5, "six-grid": 6,
  "photo-text": 1, "text-photo": 1, "text-only": 0,
  "two-up": 2, "three-grid": 3,
};

// resizeCtx = { overrides, onColChange, onRowChange } when page is focused, else null.
function renderTemplate(template, renderSlots, pg, resizeCtx) {
  const slots = renderSlots();
  const ov = pg.layoutOverrides || {};
  const { onColChange, onRowChange } = resizeCtx || {};

  // Shorthand: resizable grid wrapper
  const RG = ({ cls, defaultCol, defaultRow, children }) => (
    <ResizableGrid
      gridClass={cls}
      defaultCol={defaultCol} defaultRow={defaultRow}
      overrideCol={ov.columns || null} overrideRow={ov.rows || null}
      onColChange={onColChange} onRowChange={onRowChange}
    >{children}</ResizableGrid>
  );

  switch (template) {
    case "full-bleed":
      return <div className="tpl-full-bleed" style={{ width: "100%", height: "100%" }}>{slots}</div>;

    case "photo-text":
      return (
        <RG cls="tpl-photo-text" defaultRow="3fr 2fr">
          {slots[0]}
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
        </RG>
      );

    case "text-photo":
      return (
        <RG cls="tpl-text-photo" defaultCol="9fr 11fr">
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
          {slots[0]}
        </RG>
      );

    case "text-only":
      return (
        <div className="tpl-text-only" style={{ height: "100%" }}>
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
        </div>
      );

    case "two-equal": case "two-up":
      return <RG cls="tpl-two-equal" defaultCol="1fr 1fr">{slots}</RG>;

    case "hero-left":
      return <RG cls="tpl-hero-left" defaultCol="7fr 3fr">{slots}</RG>;

    case "hero-right":
      return <RG cls="tpl-hero-right" defaultCol="3fr 7fr">{slots}</RG>;

    case "hero-top":
      return <RG cls="tpl-hero-top" defaultRow="13fr 7fr">{slots}</RG>;

    case "three-banner": case "three-grid":
      return <RG cls="tpl-three-banner" defaultRow="3fr 2fr">{slots}</RG>;

    case "three-sidebar":
      return <RG cls="tpl-three-sidebar" defaultCol="3fr 2fr">{slots}</RG>;

    case "panoramic-strip":
      return <div className="tpl-panoramic-strip bk-grid" style={{
        height: "100%",
        gridTemplateRows: ov.rows || undefined,
      }}>{slots}</div>;

    case "four-grid":
      return <RG cls="tpl-four-grid" defaultCol="1fr 1fr" defaultRow="1fr 1fr">{slots}</RG>;

    case "four-asymmetric":
      return <RG cls="tpl-four-asymmetric" defaultCol="3fr 2fr" defaultRow="3fr 2fr">{slots}</RG>;

    case "five-mosaic":
      return (
        <div className="tpl-five-mosaic" style={{ height: "100%" }}>
          {slots[0]}
          <div className="mosaic-right">{slots.slice(1)}</div>
        </div>
      );

    case "six-grid":
      return <div className="tpl-six-grid bk-grid" style={{ height: "100%" }}>{slots}</div>;

    default:
      return <div className="tpl-text-only" style={{ height: "100%" }} />;
  }
}
