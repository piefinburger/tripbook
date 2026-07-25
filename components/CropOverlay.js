"use client";
// Crop overlay: click to set focal point, drag to fine-tune, zoom slider.
// Extracted from PageCanvas so FreestyleCanvas can also use it.
import { useRef, useState, useCallback } from "react";

export default function CropOverlay({ photo, style, onChange, onClose }) {
  const [pos, setPos] = useState(() => parsePos(style.objectPosition));
  const [zoom, setZoom] = useState(style.scale ?? 1.0);
  const dragging = useRef(false);
  const startRef = useRef(null);
  const startPosRef = useRef(null);
  const overlayRef = useRef(null);

  const imgSrc = photo.previewUrl || photo.url;

  const commit = useCallback((newPos, newZoom) => {
    onChange({
      objectPosition: `${Math.round(newPos.x)}% ${Math.round(newPos.y)}%`,
      scale: Math.round(newZoom * 100) / 100,
    });
  }, [onChange]);

  const onPointerDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    const rect = overlayRef.current.getBoundingClientRect();
    const newPos = {
      x: clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
    setPos(newPos);
    commit(newPos, zoom);
    dragging.current = true;
    startRef.current = { x: e.clientX, y: e.clientY };
    startPosRef.current = newPos;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const sensitivity = 0.15 / Math.max(zoom, 1);
    const newPos = {
      x: clamp(startPosRef.current.x + (e.clientX - startRef.current.x) * sensitivity, 0, 100),
      y: clamp(startPosRef.current.y + (e.clientY - startRef.current.y) * sensitivity, 0, 100),
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
      ref={overlayRef}
      className="crop-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={e => e.stopPropagation()}
    >
      <img
        src={imgSrc}
        alt=""
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          objectPosition: `${pos.x}% ${pos.y}%`,
          transform: zoom !== 1 ? `scale(${zoom})` : undefined,
          transformOrigin: zoom !== 1 ? `${pos.x}% ${pos.y}%` : undefined,
          display: "block", pointerEvents: "none",
        }}
        draggable={false}
      />
      <div className="crop-crosshair" style={{ left: `${pos.x}%`, top: `${pos.y}%` }} />
      <div className="crop-ui" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <div className="crop-zoom">
          <span>Zoom</span>
          <input
            type="range" min={1} max={3} step={0.05}
            value={zoom}
            onChange={onZoom}
            onPointerDown={e => e.stopPropagation()}
          />
          <span className="crop-zoom-pct">{Math.round(zoom * 100)}%</span>
        </div>
        <button className="crop-done" onClick={e => { e.stopPropagation(); onClose(); }}>
          Done
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
