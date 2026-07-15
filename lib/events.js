// Live updates (SSE). Single-node pubsub: the app runs as exactly one
// container on one Lightsail instance, so an in-process emitter is correct
// and adds no infrastructure. If this ever scales past one instance, this
// module is the seam to swap for Redis pub/sub.
const g = globalThis;
g.__tripSubs ??= new Map(); // tripId -> Set<controller>

export function subscribe(tripId, controller) {
  const key = String(tripId);
  if (!g.__tripSubs.has(key)) g.__tripSubs.set(key, new Set());
  g.__tripSubs.get(key).add(controller);
  return () => {
    g.__tripSubs.get(key)?.delete(controller);
    if (g.__tripSubs.get(key)?.size === 0) g.__tripSubs.delete(key);
  };
}

export function emitTrip(tripId, type = "update") {
  const subs = g.__tripSubs.get(String(tripId));
  if (!subs) return;
  const payload = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  for (const c of subs) {
    try { c.enqueue(payload); } catch { subs.delete(c); }
  }
}
