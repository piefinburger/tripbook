"use client";
// Freestyle page canvas: renders absolutely-positioned photo and text elements
// with selection, drag-to-move, resize handles, inline text editing,
// crop/zoom overlay, snap guides, and dot grid.
import { useRef, useState, useCallback, useMemo } from "react";
import { slotImgStyle } from "@/lib/photoStyle";
import CropOverlay from "@/components/CropOverlay";

const SNAP_THRESHOLD = 1.5; // percent — snaps when within this distance

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

  // Build snap targets from all elements + page edges/center.
  const snapTargets = useMemo(() => {
    const targets = { x: [0, 50, 100], y: [0, 50, 100] };
    for (const el of pg.elements || []) {
      targets.x.push(el.x, el.x + el.w, el.x + el.w / 2);
      targets.y.push(el.y, el.y + el.h, el.y + el.h / 2);
    }
    return targets;
  }, [pg.elements]);

  // Snap a value to nearest target and return guide info.
  const snapAndGuide = useCallback((val, axis, excludeId) => {
    const others = [];
    // Page edges/center
    for (const v of [0, 50, 100]) others.push(v);
    for (const el of pg.elements || []) {
      if (el.id === excludeId) continue;
      if (axis === "x") { others.push(el.x, el.x + el.w, el.x + el.w / 2); }
      else { others.push(el.y, el.y + el.h, el.y + el.h / 2); }
    }
    let best = val, bestDist = Infinity;
    for (const t of others) {
      const d = Math.abs(val - t);
      if (d < bestDist && d < SNAP_THRESHOLD) { best = t; bestDist = d; }
    }
    return { snapped: best, guide: bestDist < SNAP_THRESHOLD ? best : null };
  }, [pg.elements]);

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
  const onBgClick = () => { if (focused) { onSelectElement(null); setGuides([]); } };

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
      {/* Dot grid for visual alignment */}
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
          snapAndGuide={snapAndGuide}
          setGuides={setGuides}
        />
      ))}

      {/* Snap guide lines */}
      {guides.map((g, i) => (
        <div
          key={i}
          className={`fs-guide fs-guide-${g.axis}`}
          style={g.axis === "x" ? { left: `${g.pos}%` } : { top: `${g.pos}%` }}
        />
      ))}
    </div>
  );
}

function FreestyleElement({
  el, photoById, focused, selected,
  onSelect, onUpdate, onRemove, onDropPhoto,
  containerRef, draggingPhotoId,
  snapAndGuide, setGuides,
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
    if (!dragStart.current) return;
    if (resizing) return;
    const dx = ((e.clientX - dragStart.current.px) / dragStart.current.cw) * 100;
    const dy = ((e.clientY - dragStart.current.py) / dragStart.current.ch) * 100;
    let newX = clamp(dragStart.current.startX + dx, 0, 100 - el.w);
    let newY = clamp(dragStart.current.startY + dy, 0, 100 - el.h);

    // Snap edges and center
    const activeGuides = [];
    const snapL = snapAndGuide(newX, "x", el.id);
    const snapR = snapAndGuide(newX + el.w, "x", el.id);
    const snapCx = snapAndGuide(newX + el.w / 2, "x", el.id);
    if (snapCx.guide !== null) { newX = snapCx.snapped - el.w / 2; activeGuides.push({ axis: "x", pos: snapCx.guide }); }
    else if (snapL.guide !== null) { newX = snapL.snapped; activeGuides.push({ axis: "x", pos: snapL.guide }); }
    else if (snapR.guide !== null) { newX = snapR.snapped - el.w; activeGuides.push({ axis: "x", pos: snapR.guide }); }

    const snapT = snapAndGuide(newY, "y", el.id);
    const snapB = snapAndGuide(newY + el.h, "y", el.id);
    const snapCy = snapAndGuide(newY + el.h / 2, "y", el.id);
    if (snapCy.guide !== null) { newY = snapCy.snapped - el.h / 2; activeGuides.push({ axis: "y", pos: snapCy.guide }); }
    else if (snapT.guide !== null) { newY = snapT.snapped; activeGuides.push({ axis: "y", pos: snapT.guide }); }
    else if (snapB.guide !== null) { newY = snapB.snapped - el.h; activeGuides.push({ axis: "y", pos: snapB.guide }); }

    setGuides(activeGuides);
    onUpdate({ x: round1(newX), y: round1(newY) });
  };

  const onPointerUp = () => {
    dragStart.current = null;
    setMoving(false);
    setGuides([]);
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

    onUpdate({ x: round1(x), y: round1(y), w: round1(w), h: round1(h) });
  };

  const onResizeEnd = () => {
    setResizing(null);
    dragStart.current = null;
  };

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
    cursor: focused ? (moving ? "grabbing" : "grab") : "default",
  };

  return (
    <div
      className={`fs-element ${selected ? "fs-element-selected" : ""} ${moving ? "fs-element-moving" : ""} ${over ? "pg-slot-over" : ""}`}
      style={elStyle}
      onClick={e => { e.stopPropagation(); onSelect(); }}
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
      {el.type === "photo" && !imgSrc && (
        <div className="fs-photo-empty">
          {draggingPhotoId ? "Drop here" : "+"}
        </div>
      )}

      {/* Crop overlay */}
      {el.type === "photo" && cropping && photo && (
        <CropOverlay
          photo={photo}
          style={el.photoStyle || {}}
          onChange={(newStyle) => onUpdate({ photoStyle: { ...(el.photoStyle || {}), ...newStyle } })}
          onClose={() => setCropping(false)}
        />
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

      {/* Action bar — visible above selected element */}
      {selected && focused && !cropping && (
        <div className="fs-action-bar">
          {el.type === "photo" && imgSrc && (
            <button
              className="fs-action-btn"
              onClick={e => { e.stopPropagation(); setCropping(true); }}
              title="Crop / Zoom"
            >Crop</button>
          )}
          <button
            className="fs-action-btn fs-action-delete"
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title="Delete"
          >Delete</button>
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
