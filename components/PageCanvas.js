"use client";
// WYSIWYG page canvas (SPEC-WYSIWYG-EDITOR Phase 1 + 2).
// Phase 2 adds per-photo zoom/crop via objectPosition + scale stored in
// pg.photoStyles[photoId].
import { useEffect, useRef, useState, useCallback } from "react";

const PAGE_PX = 816; // 8.5in × 96dpi

export default function PageCanvas({
  pg,
  photoById,
  focused,
  onFocus,
  onPlacePhoto,     // (slotIndex, photoId)
  onRemovePhoto,    // (slotIndex)
  onPhotoStyle,     // (photoId, style) — saves crop/zoom
  onCaption,
  onText,
  draggingPhotoId,
  awaitingSlot,
  onSlotClick,
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

  const inner = renderTemplate(pg.template, renderSlots, pg);

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

  const imgStyle = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    objectPosition: photoStyle.objectPosition || "50% 50%",
    transform: photoStyle.scale && photoStyle.scale !== 1 ? `scale(${photoStyle.scale})` : undefined,
    transformOrigin: "center center",
  };

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
          <img src={photo.url} alt="" style={imgStyle} draggable={false} />

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

// ── Crop overlay ──────────────────────────────────────────────────────────────
// Shown inside a slot when it's clicked while focused. Drag to reposition,
// slider to zoom. Saves on close via onStyleChange.
function CropOverlay({ photo, style, onChange, onClose }) {
  const [pos, setPos] = useState(() => parsePos(style.objectPosition));
  const [zoom, setZoom] = useState(style.scale ?? 1.0);
  const dragging = useRef(false);
  const startRef = useRef(null);
  const startPosRef = useRef(null);

  const commit = useCallback((newPos, newZoom) => {
    onChange({
      objectPosition: `${Math.round(newPos.x)}% ${Math.round(newPos.y)}%`,
      scale: Math.round(newZoom * 100) / 100,
    });
  }, [onChange]);

  const onPointerDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    dragging.current = true;
    startRef.current = { x: e.clientX, y: e.clientY };
    startPosRef.current = { ...pos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    // Moving pointer RIGHT → objectPosition.x decreases (pan left)
    // Moving pointer DOWN → objectPosition.y decreases (pan up)
    // Factor: 100px drag = ~30% position change at zoom 1
    const dx = (e.clientX - startRef.current.x) / (3 * zoom);
    const dy = (e.clientY - startRef.current.y) / (3 * zoom);
    const newPos = {
      x: clamp(startPosRef.current.x - dx, 0, 100),
      y: clamp(startPosRef.current.y - dy, 0, 100),
    };
    setPos(newPos);
    commit(newPos, zoom);
  };
  const onPointerUp = () => { dragging.current = false; };

  const onZoom = (e) => {
    const newZoom = Number(e.target.value);
    setZoom(newZoom);
    commit(pos, newZoom);
  };

  return (
    <div
      className="crop-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={e => e.stopPropagation()}
    >
      {/* live preview of the crop */}
      <img
        src={photo.url}
        alt=""
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          objectPosition: `${pos.x}% ${pos.y}%`,
          transform: zoom !== 1 ? `scale(${zoom})` : undefined,
          transformOrigin: "center center",
          display: "block", pointerEvents: "none",
        }}
        draggable={false}
      />

      {/* overlay UI — zoom slider + done button */}
      <div className="crop-ui" onClick={e => e.stopPropagation()}>
        <span className="crop-hint">Drag to reposition</span>
        <div className="crop-zoom">
          <span>🔍</span>
          <input
            type="range" min={1} max={3} step={0.05}
            value={zoom}
            onChange={onZoom}
            onPointerDown={e => e.stopPropagation()}
          />
          <span>{Math.round(zoom * 100)}%</span>
        </div>
        <button className="crop-done" onClick={e => { e.stopPropagation(); onClose(); }}>
          ✓ Done
        </button>
      </div>
    </div>
  );
}

function parsePos(str) {
  if (!str) return { x: 50, y: 50 };
  const [x, y] = str.split(" ").map(v => parseFloat(v) || 50);
  return { x, y };
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Template → DOM structure ──────────────────────────────────────────────────
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
    case "two-equal": case "two-up":
      return <div className="tpl-two-equal bk-grid" style={{ height: "100%" }}>{slots}</div>;
    case "hero-left":
      return <div className="tpl-hero-left bk-grid" style={{ height: "100%" }}>{slots}</div>;
    case "hero-right":
      return <div className="tpl-hero-right bk-grid" style={{ height: "100%" }}>{slots}</div>;
    case "hero-top":
      return <div className="tpl-hero-top bk-grid" style={{ height: "100%" }}>{slots}</div>;
    case "three-banner": case "three-grid":
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
