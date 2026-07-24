"use client";
// WYSIWYG page canvas (SPEC-WYSIWYG-EDITOR Phase 1).
// Renders a scaled interactive version of a book page using the same
// tpl-* CSS classes as BookPages.js. Photo slots accept drops (desktop)
// or tap-to-select (iOS).
import { useEffect, useRef, useState } from "react";

const PAGE_PX = 816; // 8.5in × 96dpi

export default function PageCanvas({
  pg,
  photoById,
  focused,
  onFocus,
  onPlacePhoto,   // (slotIndex, photoId)
  onRemovePhoto,  // (slotIndex)
  onCaption,
  onText,
  draggingPhotoId, // photoId being dragged from sidebar, or null
  awaitingSlot,   // slot index awaiting tap-to-place, or null
  onSlotClick,    // (slotIndex)
}) {
  const wrapperRef = useRef(null);
  const [scale, setScale] = useState(0.27);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setScale(e.contentRect.width / PAGE_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ids = pg.photoIds || [];
  const slotCount = TPL_SLOTS[pg.template] ?? 0;

  // Build an array of slot entries: { photoId | null }
  const slots = Array.from({ length: slotCount }, (_, i) => ids[i] ?? null);

  const renderSlots = () => slots.map((pid, i) => (
    <PhotoSlot
      key={i}
      photoId={pid}
      photo={pid ? photoById[pid] : null}
      slotIndex={i}
      awaiting={awaitingSlot === i}
      dragging={draggingPhotoId != null}
      onDrop={(photoId) => onPlacePhoto(i, photoId)}
      onRemove={() => onRemovePhoto(i)}
      onClick={() => onSlotClick(i)}
    />
  ));

  const inner = renderTemplate(pg.template, renderSlots, pg);

  return (
    <div
      ref={wrapperRef}
      className={`page-canvas-wrap ${focused ? "page-canvas-focused" : ""}`}
      onClick={!focused ? onFocus : undefined}
      title={focused ? undefined : "Click to edit this page"}
    >
      <div
        className={`page-canvas-inner tpl-base`}
        style={{ width: PAGE_PX, height: PAGE_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {inner}

        {/* caption / text fields are overlaid below the content */}
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
function PhotoSlot({ photo, slotIndex, awaiting, dragging, onDrop, onRemove, onClick }) {
  const [over, setOver] = useState(false);

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
          <img
            src={photo.url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            draggable={false}
          />
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

// ── Template → DOM structure ──────────────────────────────────────────────────
// Mirrors BookPages.js structure exactly so tpl-* CSS applies.
const TPL_SLOTS = {
  "full-bleed": 1, "hero-left": 2, "hero-right": 2, "hero-top": 2, "two-equal": 2,
  "three-banner": 3, "three-sidebar": 3, "panoramic-strip": 3,
  "four-grid": 4, "four-asymmetric": 4, "five-mosaic": 5, "six-grid": 6,
  "photo-text": 1, "text-photo": 1, "text-only": 0,
  "two-up": 2, "three-grid": 3,
};

function renderTemplate(template, renderSlots, pg) {
  const slots = renderSlots();

  switch (template) {
    case "full-bleed":
      return <div className="tpl-full-bleed" style={{ width: "100%", height: "100%" }}>{slots}</div>;

    case "photo-text":
      return (
        <div className="tpl-photo-text" style={{ height: "100%" }}>
          {slots[0]}
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
        </div>
      );

    case "text-photo":
      return (
        <div className="tpl-text-photo" style={{ height: "100%" }}>
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
          {slots[0]}
        </div>
      );

    case "text-only":
      return (
        <div className="tpl-text-only" style={{ height: "100%" }}>
          <div className="txt-block canvas-editable">{pg.text || <span className="slot-placeholder">Text goes here…</span>}</div>
        </div>
      );

    case "two-equal":
    case "two-up":
      return <div className="tpl-two-equal bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "hero-left":
      return <div className="tpl-hero-left bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "hero-right":
      return <div className="tpl-hero-right bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "hero-top":
      return <div className="tpl-hero-top bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "three-banner":
    case "three-grid":
      return <div className="tpl-three-banner bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "three-sidebar":
      return <div className="tpl-three-sidebar bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "panoramic-strip":
      return <div className="tpl-panoramic-strip bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "four-grid":
      return <div className="tpl-four-grid bk-grid" style={{ height: "100%" }}>{slots}</div>;

    case "four-asymmetric":
      return <div className="tpl-four-asymmetric bk-grid" style={{ height: "100%" }}>{slots}</div>;

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
