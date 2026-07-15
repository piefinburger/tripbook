"use client";
// Offline outbox. iOS Safari has no Background Sync, so we queue in IndexedDB
// and flush whenever the app is open: launch, online event, tab visible, and
// after each successful send. Photos are stored as compressed blobs.

const DB = "tripbook-outbox";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction("items", mode);
    const out = fn(t.objectStore("items"));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export async function queueItem(item) {
  item.key = crypto.randomUUID();
  item.queuedAt = Date.now();
  await tx("readwrite", s => s.put(item));
  flushOutbox();
  return item.key;
}
export async function outboxCount() {
  return tx("readonly", s => s.count());
}

let flushing = false;
export async function flushOutbox(onChange) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const items = await tx("readonly", s => s.getAll());
    for (const item of (items.sort((a, b) => a.queuedAt - b.queuedAt))) {
      try {
        if (item.kind === "entry") {
          const r = await fetch("/api/entries", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.payload)
          });
          if (!r.ok) throw new Error("entry send failed");
        } else if (item.kind === "photo") {
          const pre = await fetch("/api/photos/presign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.meta)
          });
          if (!pre.ok) throw new Error("presign failed");
          const { photoId, putUrl } = await pre.json();
          const put = await fetch(putUrl, {
            method: "PUT", headers: { "Content-Type": item.meta.contentType }, body: item.blob
          });
          if (!put.ok) throw new Error("S3 PUT failed");
          const done = await fetch("/api/photos/complete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoId })
          });
          if (!done.ok) throw new Error("complete failed");
        }
        await tx("readwrite", s => s.delete(item.key));
        onChange?.(await outboxCount());
      } catch {
        break; // stop on first failure; retry on next flush trigger
      }
    }
  } finally {
    flushing = false;
    onChange?.(await outboxCount());
  }
}

export function installFlushTriggers(onChange) {
  const run = () => flushOutbox(onChange);
  window.addEventListener("online", run);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  run();
}

// Downscale before queueing so IndexedDB stays small and uploads are fast.
export async function compressImage(file, maxDim = 2400, quality = 0.82) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => {
      const bail = setTimeout(() => res(null), 15000); // belt and suspenders
      canvas.toBlob(b => { clearTimeout(bail); res(b); }, "image/jpeg", quality);
    });
    return blob || file;
  } catch {
    return file; // e.g. HEIC createImageBitmap failure; upload the original
  }
}

export function getPosition(timeout = 6000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res({});
    // iOS WebKit: the timeout option does not apply while the permission
    // prompt is unresolved, and in some PWA/camera-return states NEITHER
    // callback ever fires. A hard timer guarantees this promise settles,
    // so a photo can never hang on location. No fix in time = no geotag.
    let done = false;
    const settle = (v) => { if (!done) { done = true; clearTimeout(bail); res(v); } };
    const bail = setTimeout(() => settle({}), timeout + 2000);
    navigator.geolocation.getCurrentPosition(
      p => settle({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => settle({}), { timeout, maximumAge: 120000 });
  });
}
