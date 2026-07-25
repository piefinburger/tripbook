// Shared helper: converts a photoStyle record into CSS properties for an img.
// Used by both PageCanvas (editor) and BookPages (server renderer) so the two
// always apply identical crop math.
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
