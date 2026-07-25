"use client";
// Freestyle page canvas: renders absolutely-positioned photo and text elements
// with selection, drag-to-move, resize handles, crop/zoom, snap guides, and
// inline text editing.
import { useRef, useState, useCallback, useMemo } from "react";
import { slotImgStyle } from "@/lib/photoStyle";
import CropOverlay from "@/components/CropOverlay";

// Snap threshold in percentage points
const SNAP_THRESHOLD = 1.5;

export default function FreestyleCanvas({
  pg, photoById, focused,
  selectedElementId, onSelectElement,
  onUpdateElement, onRemoveElement,
  onPlacePhotoInElement,
  draggingPhotoId,
}) {
  const containerRef = useRef(null);
  const [guides, setGuides] = useState([]);
  const elements = (pg.elements || []).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  // Build snap targets from all elements except the selected one + page edges/center
  const snapTargets = useMemo(() => {
    const targets = { x: [0, 50, 100], y: [0, 50, 100] }; // page edges + center
    for (const el of pg.elements || []) {
      if (el.id === selectedElementId) continue;
      // Element edges and center
      targets.x.push(el.x, el.x + el.w / 2, el.x + el.w);
      targets.y.push(el.y, el.y + el.h / 2, el.y + el.h);
    }
    return targets;
  }, [pg.elements, selectedElementId]);

  // Convert a client pixel position to page-percentage coordinates.
  const clientToPercent = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 10, y: 10 };
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  // Background click deselects.
  const onBgClick = () => { if (focused) onSelectElement(null); };

  // Drop photo from tray onto freestyle page background.
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    const photoId = Number(e.dataTransfer.getData("photoId"));
    if (!photoId) return;
    const pos = clientToPercent(e.clientX, e.clientY);
    onPlacePhotoInElement(null, photoId, {
      x: Math.max(0, Math.min(65, pos.x - 17.5)),
      y: Math.max(0, Math.min(65, pos.y - 17.5)),
      w: 35, h: 35,
    });
  };

  return (
    <div
      ref={containerRef}
      className="fs-container"
      onClick={onBgClick}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={onDrop}
    >
      {/* Dot grid for positioning reference */}
      {focused && <div className="fs-dot-grid" />}

      {elements.length === 0 && focused && (
        <div className="fs-empty">Add photos or text to this page</div>
      )}
      {elements.map(el => (
        <FreestyleElement
          key={el.id}
          el={el}
          photoById={photoById}
          focused={focused}
          selected={selectedElementId === el.id}
          onSelect={() => focused && onSelectElement(el.id)}
          onUpdate={(changes) => onUpdateElement(el.id, changes)}
          onRemove={() => onRemoveElement(el.id)}
          onDropPhoto={(photoId) => onPlacePhotoInElement(el.id, photoId)}
          containerRef={containerRef}
          draggingPhotoId={draggingPhotoId}
          snapTargets={snapTargets}
          onGuidesChange={setGuides}
        />
      ))}

      {/* Snap guide lines */}
      {guides.map((g, i) => (
        <div key={i} className={`fs-guide fs-guide-${g.axis}`}
          style={g.axis === "x" ? { left: `${g.pos}%` } : { top: `${g.pos}%` }} />
      ))}
    </div>
  );
}

function FreestyleElement({
  el, photoById, focused, selected,
  onSelect, onUpdate, onRemove, onDropPhoto,
  containerRef, draggingPhotoId,
  snapTargets, onGuidesChange,
}) {
  const [moving, setMoving] = useState(false);
  const [resizing, setResizing] = useState(null);
  const [editing, setEditing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const dragStart = useRef(null);
  const textRef = useRef(null);
  const [over, setOver] = useState(false);

  const photo = el.type === "photo" && el.photoId ? photoById[el.photoId] : null;
  const imgSrc = photo?.previewUrl || photo?.url;

  // ── Snapping ─────────────────────────────────────────────
  const snapAndGuide = useCallback((x, y, w, h) => {
    const guides = [];
    const edges = {
      x: [x, x + w / 2, x + w],  // left, center, right
      y: [y, y + h / 2, y + h],   // top, center, bottom
    };

    let snappedX = x, snappedY = y;

    // Snap X axis
    for (const edge of edges.x) {
      for (const target of snapTargets.x) {
        if (Math.abs(edge - target) < SNAP_THRESHOLD) {
          snappedX = x + (target - edge);
          guides.push({ axis: "x", pos: target });
          break;
        }
      }
    }

    // Snap Y axis
    for (const edge of edges.y) {
      for (const target of snapTargets.y) {
        if (Math.abs(edge - target) < SNAP_THRESHOLD) {
          snappedY = y + (target - edge);
          guides.push({ axis: "y", pos: target });
          break;
        }
      }
    }

    onGuidesChange(guides);
    return { x: snappedX, y: snappedY };
  }, [snapTargets, onGuidesChange]);

  const clearGuides = useCallback(() => onGuidesChange([]), [onGuidesChange]);

  // ── Drag to move ─────────────────────────────────────────
  const onPointerDown = (e) => {
    if (!focused || resizing || editing || cropping) return;
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    onSelect();
    const rect = containerRef.current.getBoundingClientRect();
    dragStart.current = {
      px: e.clientX, py: e.clientY,
      startX: el.x, startY: el.y,
      cw: rect.width, ch: rect.height,
    };
    setMoving(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragStart.current || resizing) return;
    const dx = ((e.clientX - dragStart.current.px) / dragStart.current.cw) * 100;
    const dy = ((e.clientY - dragStart.current.py) / dragStart.current.ch) * 100;
    let newX = clamp(dragStart.current.startX + dx, 0, 100 - el.w);
    let newY = clamp(dragStart.current.startY + dy, 0, 100 - el.h);
    const snapped = snapAndGuide(newX, newY, el.w, el.h);
    onUpdate({ x: round1(snapped.x), y: round1(snapped.y) });
  };

  const onPointerUp = () => {
    dragStart.current = null;
    setMoving(false);
    clearGuides();
  };

  // ── Resize handles ───────────────────────────────────────
  const onResizeStart = (handle, e) => {
    e.stopPropagation(); e.preventDefault();
    setResizing(handle);
    const rect = containerRef.current.getBoundingClientRect();
    dragStart.current = {
      px: e.clientX, py: e.clientY,
      startX: el.x, startY: el.y, startW: el.w, startH: el.h,
      cw: rect.width, ch: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e) => {
    if (!resizing || !dragStart.current) return;
    const dx = ((e.clientX - dragStart.current.px) / dragStart.current.cw) * 100;
    const dy = ((e.clientY - dragStart.current.py) / dragStart.current.ch) * 100;
    const s = dragStart.current;
    const MIN = 5;
    let { x, y, w, h } = { x: s.startX, y: s.startY, w: s.startW, h: s.startH };

    const moveLeft = resizing.includes("w");
    const moveRight = resizing.includes("e");
    const moveTop = resizing.includes("n");
    const moveBottom = resizing.includes("s");

    if (moveRight) w = Math.max(MIN, Math.min(100 - x, s.startW + dx));
    if (moveLeft) {
      const newX = clamp(s.startX + dx, 0, s.startX + s.startW - MIN);
      w = s.startW + (s.startX - newX);
      x = newX;
    }
    if (moveBottom) h = Math.max(MIN, Math.min(100 - y, s.startH + dy));
    if (moveTop) {
      const newY = clamp(s.startY + dy, 0, s.startY + s.startH - MIN);
      h = s.startH + (s.startY - newY);
      y = newY;
    }

    const snapped = snapAndGuide(x, y, w, h);
    onUpdate({ x: round1(snapped.x), y: round1(snapped.y), w: round1(w), h: round1(h) });
  };

  const onResizeEnd = () => {
    setResizing(null);
    dragStart.current = null;
    clearGuides();
  };

  // ── Crop/zoom ────────────────────────────────────────────
  const onCropClick = (e) => {
    e.stopPropagation();
    setCropping(true);
  };

  const onCropChange = useCallback((newStyle) => {
    onUpdate({ photoStyle: newStyle });
  }, [onUpdate]);

  // ── Text editing ─────────────────────────────────────────
  const onDoubleClick = (e) => {
    if (el.type !== "text" || !focused) return;
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const commitText = () => {
    if (!editing) return;
    const newText = textRef.current?.innerText || "";
    setEditing(false);
    onUpdate({ text: newText });
  };

  // ── Photo drop onto element ──────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const pid = Number(e.dataTransfer.getData("photoId"));
    if (pid && el.type === "photo") onDropPhoto(pid);
  };

  const elStyle = {
    position: "absolute",
    left: `${el.x}%`, top: `${el.y}%`,
    width: `${el.w}%`, height: `${el.h}%`,
    zIndex: el.zIndex || 1,
    cursor: focused ? (cropping ? "default" : moving ? "grabbing" : "grab") : "default",
  };

  return (
    <div
      className={`fs-element ${selected ? "fs-element-selected" : ""} ${moving ? "fs-element-moving" : ""} ${over ? "pg-slot-over" : ""}`}
      style={elStyle}
      onClick={e => { e.stopPropagation(); if (!cropping) onSelect(); }}
      onPointerDown={el.type === "text" && editing ? undefined : (cropping ? undefined : onPointerDown)}
      onPointerMove={moving ? onPointerMove : undefined}
      onPointerUp={moving ? onPointerUp : undefined}
      onDoubleClick={onDoubleClick}
      onDragOver={el.type === "photo" ? (e => { e.preventDefault(); e.stopPropagation(); setOver(true); }) : undefined}
      onDragLeave={el.type === "photo" ? (() => setOver(false)) : undefined}
      onDrop={el.type === "photo" ? handleDrop : undefined}
    >
      {/* Photo element */}
      {el.type === "photo" && imgSrc && !cropping && (
        <img src={imgSrc} alt="" style={slotImgStyle(el.photoStyle)} draggable={false} />
      )}
      {el.type === "photo" && imgSrc && cropping && (
        <CropOverlay
          photo={photo}
          style={el.photoStyle || {}}
          onChange={onCropChange}
          onClose={() => setCropping(false)}
        />
      )}
      {el.type === "photo" && !imgSrc && (
        <div className="fs-photo-empty">
          {draggingPhotoId ? "Drop here" : "+"}
        </div>
      )}

      {/* Text element */}
      {el.type === "text" && !editing && (
        <div className="fs-text-display" style={{
          fontSize: `${el.fontSize || 12}pt`,
          color: el.color || "#14343b",
          fontWeight: el.fontWeight || "normal",
          textAlign: el.align || "left",
        }}>
          {el.text || (focused ? "Double-click to edit" : "")}
        </div>
      )}
      {el.type === "text" && editing && (
        <div
          ref={textRef}
          className="fs-text-editing"
          contentEditable
          suppressContentEditableWarning
          style={{
            fontSize: `${el.fontSize || 12}pt`,
            color: el.color || "#14343b",
            fontWeight: el.fontWeight || "normal",
            textAlign: el.align || "left",
          }}
          onBlur={commitText}
          onKeyDown={e => { if (e.key === "Escape") commitText(); }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {el.text}
        </div>
      )}

      {/* Action buttons — visible when selected */}
      {selected && focused && !cropping && (
        <div className="fs-action-bar">
          <button className="fs-action-btn fs-action-delete" onClick={e => { e.stopPropagation(); onRemove(); }} title="Delete">
            Delete
          </button>
          {el.type === "photo" && imgSrc && (
            <button className="fs-action-btn" onClick={onCropClick} title="Crop & zoom">
              Crop
            </button>
          )}
        </div>
      )}

      {/* Resize handles (8 points) */}
      {selected && focused && !cropping && HANDLES.map(h => (
        <div
          key={h.name}
          className={`fs-handle fs-handle-${h.name}`}
          onPointerDown={e => onResizeStart(h.name, e)}
          onPointerMove={resizing === h.name ? onResizeMove : undefined}
          onPointerUp={resizing === h.name ? onResizeEnd : undefined}
        />
      ))}
    </div>
  );
}

const HANDLES = [
  { name: "nw" }, { name: "n" }, { name: "ne" },
  { name: "w" },                  { name: "e" },
  { name: "sw" }, { name: "s" }, { name: "se" },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
