// Client-side metadata extraction for library uploads (SPEC-GALLERY D3).
// Runs on the ORIGINAL file before canvas compression strips EXIF.
// Covers: JPEG EXIF (DateTimeOriginal + GPS) and MP4/MOV mvhd creation time.
// Everything is best-effort; callers fall back to file.lastModified.

function parseExifDate(s) {
  // "YYYY:MM:DD HH:MM:SS" in local time of the camera
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d) ? null : d;
}

export async function readJpegExif(file) {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer(); // EXIF lives up front
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {}; // not a JPEG
  let off = 2;
  // find APP1/Exif segment
  while (off + 4 < v.byteLength) {
    if (v.getUint8(off) !== 0xff) return {};
    const marker = v.getUint8(off + 1);
    const size = v.getUint16(off + 2);
    if (marker === 0xe1 &&
        v.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
      return parseTiff(new DataView(buf, off + 10, size - 8));
    }
    if (marker === 0xda) return {}; // start of scan; no EXIF
    off += 2 + size;
  }
  return {};
}

function parseTiff(v) {
  try {
    const le = v.getUint16(0) === 0x4949; // "II" little endian
    const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
    const ifd0 = u32(4);
    let exifOff = 0, gpsOff = 0;
    const walk = (dirOff, wanted) => {
      const out = {};
      if (dirOff + 2 > v.byteLength) return out;
      const n = u16(dirOff);
      for (let i = 0; i < n; i++) {
        const e = dirOff + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        if (tag === 0x8769) exifOff = u32(e + 8);
        if (tag === 0x8825) gpsOff = u32(e + 8);
        if (!wanted?.has(tag)) continue;
        const sz = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }[type] || 1;
        const total = sz * count;
        const valOff = total <= 4 ? e + 8 : u32(e + 8);
        if (valOff + total > v.byteLength) continue;
        if (type === 2) { // ASCII
          let s = "";
          for (let j = 0; j < count - 1; j++) s += String.fromCharCode(v.getUint8(valOff + j));
          out[tag] = s;
        } else if (type === 5 || type === 10) { // rationals
          const arr = [];
          for (let j = 0; j < count; j++)
            arr.push(u32(valOff + j * 8) / (u32(valOff + j * 8 + 4) || 1));
          out[tag] = arr;
        }
      }
      return out;
    };
    walk(ifd0, null); // locate sub-IFD pointers
    const exif = exifOff ? walk(exifOff, new Set([0x9003])) : {};
    const gps = gpsOff ? walk(gpsOff,
      new Set([0x0001, 0x0002, 0x0003, 0x0004])) : {};
    const dms = (a) => a && a.length === 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null;
    let lat = dms(gps[0x0002]), lng = dms(gps[0x0004]);
    if (lat != null && /s/i.test(gps[0x0001] || "")) lat = -lat;
    if (lng != null && /w/i.test(gps[0x0003] || "")) lng = -lng;
    return {
      takenAt: parseExifDate(exif[0x9003]),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    };
  } catch { return {}; }
}

// MP4/MOV: mvhd creation time (seconds since 1904-01-01 UTC). Scans the
// first 4 MB; if the moov atom is at the tail (non-faststart), we skip.
export async function readMp4CreatedAt(file) {
  try {
    const buf = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
    const v = new DataView(buf);
    const EPOCH_1904 = Date.UTC(1904, 0, 1);
    const scan = (start, end) => {
      let off = start;
      while (off + 8 <= end) {
        const size = v.getUint32(off);
        const type = String.fromCharCode(v.getUint8(off + 4), v.getUint8(off + 5),
          v.getUint8(off + 6), v.getUint8(off + 7));
        if (size < 8) return null;
        const boxEnd = Math.min(off + size, end);
        if (type === "moov") { const r = scan(off + 8, boxEnd); if (r) return r; }
        if (type === "mvhd" && off + 20 <= end) {
          const ver = v.getUint8(off + 8);
          const secs = ver === 1
            ? Number(v.getBigUint64(off + 12)) : v.getUint32(off + 12);
          const d = new Date(EPOCH_1904 + secs * 1000);
          return d.getFullYear() > 1971 ? d : null; // zeroed field guard
        }
        off += size;
      }
      return null;
    };
    return scan(0, v.byteLength);
  } catch { return null; }
}

// Poster frame + dimensions + duration from a local video file.
export function videoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement("video");
    vid.muted = true; vid.playsInline = true; vid.preload = "metadata";
    vid.src = url;
    const bail = () => { URL.revokeObjectURL(url); resolve(null); };
    vid.onerror = bail;
    vid.onloadedmetadata = () => { vid.currentTime = Math.min(0.5, (vid.duration || 1) / 2); };
    vid.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        const scale = Math.min(1, 1280 / (vid.videoWidth || 1280));
        c.width = Math.round(vid.videoWidth * scale);
        c.height = Math.round(vid.videoHeight * scale);
        c.getContext("2d").drawImage(vid, 0, 0, c.width, c.height);
        c.toBlob(b => {
          URL.revokeObjectURL(url);
          resolve(b ? { blob: b, width: vid.videoWidth, height: vid.videoHeight,
            duration: Math.round(vid.duration || 0) } : null);
        }, "image/jpeg", 0.8);
      } catch { bail(); }
    };
    setTimeout(bail, 15000);
  });
}
