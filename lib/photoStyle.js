// Shared pure helper — no "use client" dependency.
// Converts photoStyle → CSS object for an img element.
// Imported by both PageCanvas (editor, client) and BookPages (renderer, server).
export function slotImgStyle(photoStyle = {}) {
  const op = photoStyle.objectPosition || "50% 50%";
  const scale = photoStyle.scale ?? 1;
  return {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    objectPosition: op,
    transform: scale !== 1 ? `scale(${scale})` : undefined,
    // transform-origin must match objectPosition so zooming stays anchored
    // at the focal point rather than always pulling toward center.
    transformOrigin: scale !== 1 ? op : undefined,
  };
}
