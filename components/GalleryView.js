"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { compressImage } from "@/lib/outbox";
import { readJpegExif, readMp4CreatedAt, videoPoster } from "@/lib/exifClient";

const IMAGE_OK = /^image\/(jpeg|png|heic|heif|webp)$/;
const VIDEO_OK = /^video\/(mp4|quicktime|webm|x-m4v)$/;
const initials = (name) => (name || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const dayKey = (ts) => new Date(ts).toDateString();
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function GalleryView({ tripId }) {
  const [items, setItems] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [role, setRole] = useState("member");
  const [filter, setFilter] = useState("all"); // all | untagged | member id
  const [open, setOpen] = useState(null);      // index into filtered
  const [queue, setQueue] = useState([]);      // {name, state: waiting|uploading|done|error, err}
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const j = await fetch(`/api/trips/${tripId}/gallery`).then(r => r.json());
    setItems(j.items || []); setMembers(j.members || []); setMe(j.me);
    const t = await fetch(`/api/trips/${tripId}`).then(r => r.json()).catch(() => null);
    if (t?.trip?.my_role) setRole(t.trip.my_role); else if (t?.my_role) setRole(t.my_role);
    if (t?.siteAdmin) setRole("owner"); // site admin moderates everywhere
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const es = new EventSource(`/api/trips/${tripId}/events`);
    es.onmessage = (e) => {
      try { if (JSON.parse(e.data).type === "update") load(); } catch {}
    };
    return () => es.close();
  }, [tripId, load]);

  const filtered = useMemo(() => (items || []).filter(p =>
    filter === "all" ? true :
    filter === "untagged" ? !p.place_name :
    p.user_id === Number(filter)), [items, filter]);

  const days = useMemo(() => {
    const out = [];
    for (const p of filtered) {
      const k = dayKey(p.ts);
      if (!out.length || out[out.length - 1].key !== k)
        out.push({ key: k, label: new Date(p.ts).toLocaleDateString(undefined,
          { weekday: "short", month: "short", day: "numeric" }), items: [] });
      out[out.length - 1].items.push(p);
    }
    return out;
  }, [filtered]);

  // ---- upload queue (online-only; sequential; no cap) -----------------------
  async function onPick(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const jobs = files.map(f => ({ file: f, name: f.name, state: "waiting", err: "" }));
    setQueue(qs => [...qs, ...jobs]);
    for (const job of jobs) {
      setQueue(qs => qs.map(x => x === job ? { ...x, state: "uploading" } : x));
      try {
        await uploadOne(job.file);
        setQueue(qs => qs.map(x => x === job ? { ...x, state: "done" } : x));
      } catch (err) {
        setQueue(qs => qs.map(x => x === job
          ? { ...x, state: "error", err: String(err.message || err) } : x));
      }
      load();
    }
    setTimeout(() => setQueue(qs => qs.filter(x => x.state === "error")), 4000);
  }

  async function uploadOne(file) {
    const isVideo = VIDEO_OK.test(file.type);
    if (!isVideo && !IMAGE_OK.test(file.type))
      throw new Error(`Unsupported type ${file.type || "unknown"}`);

    // metadata from the original, before any re-encoding (SPEC-GALLERY D3)
    let takenAt = null, lat = null, lng = null, poster = null;
    if (isVideo) {
      takenAt = await readMp4CreatedAt(file);
      poster = await videoPoster(file);
      if (!poster) throw new Error("Could not read this video.");
    } else if (file.type === "image/jpeg") {
      const ex = await readJpegExif(file);
      takenAt = ex.takenAt; lat = ex.lat; lng = ex.lng;
    }
    const ts = (takenAt || (file.lastModified ? new Date(file.lastModified) : new Date()))
      .toISOString();

    const pre = await fetch("/api/photos/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, contentType: file.type, ts, lat, lng,
        kind: isVideo ? "video" : "photo", source: "library",
        durationS: poster?.duration })
    });
    if (!pre.ok) throw new Error((await pre.json()).error || "Upload refused.");
    const { photoId, putUrl, posterPutUrl, posterKey } = await pre.json();

    if (isVideo) {
      let put = await fetch(putUrl, { method: "PUT",
        headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Video upload failed.");
      put = await fetch(posterPutUrl, { method: "PUT",
        headers: { "Content-Type": "image/jpeg" }, body: poster.blob });
      if (!put.ok) throw new Error("Poster upload failed.");
      const done = await fetch("/api/photos/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId, posterKey,
          width: poster.width, height: poster.height }) });
      if (!done.ok) throw new Error("Finalize failed.");
    } else {
      const blob = await compressImage(file);
      const put = await fetch(putUrl, { method: "PUT",
        headers: { "Content-Type": file.type }, body: blob });
      if (!put.ok) throw new Error("Photo upload failed.");
      const done = await fetch("/api/photos/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }) });
      if (!done.ok) throw new Error("Finalize failed.");
    }
  }

  // ---- lightbox actions ------------------------------------------------------
  const cur = open != null ? filtered[open] : null;
  const canEdit = cur && (role === "owner" || role === "admin" || cur.user_id === me);
  async function del() {
    if (!confirm("Delete this from the trip for everyone? If it is in the book, it will be removed from those pages (undoable in the editor's History).")) return;
    const r = await fetch(`/api/photos/${cur.id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error); return; }
    setOpen(null); load();
  }
  async function download() {
    const j = await fetch(`/api/photos/${cur.id}`).then(r => r.json());
    if (j.url) window.location.href = j.url;
  }
  async function setPlace() {
    const name = prompt("Where was this?", cur.place_name || "");
    if (name == null) return;
    const r = await fetch(`/api/photos/${cur.id}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeName: name }) });
    const j = await r.json();
    if (!r.ok) { alert(j.error); return; }
    load();
  }

  if (items === null) return <main><p className="muted">Loading gallery...</p></main>;

  const uploading = queue.filter(x => x.state === "uploading" || x.state === "waiting").length;
  const errors = queue.filter(x => x.state === "error");

  return (<>
    <div className="topbar">
      <Link href={`/trip/${tripId}`} style={{ color: "#cfe3ec" }}>&larr; Timeline</Link>
      <span className="brand">Gallery</span>
      {role !== "viewer"
        ? <a role="button" tabIndex={0} style={{ color: "#f2b441", fontWeight: 700, cursor: "pointer" }}
            onClick={() => fileRef.current?.click()}>Upload</a>
        : <span />}
    </div>
    <input ref={fileRef} type="file" multiple hidden
      accept="image/*,video/mp4,video/quicktime,video/webm" onChange={onPick} />
    <main className="wide">
      <div className="row gal-filter">
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter gallery">
          <option value="all">Everyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="untagged">No location</option>
        </select>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
          {uploading > 0 && ` | uploading ${uploading}...`}</span>
      </div>
      {errors.map((x, i) => <p key={i} className="error">{x.name}: {x.err}</p>)}

      {days.length === 0 && (
        <div className="card"><b>Nothing here yet</b>
          <p className="muted">Upload from your camera roll, or capture from the
            timeline. Photos land under the day they were taken.</p></div>)}

      {days.map(d => (
        <section key={d.key}>
          <div className="day-tag">{d.label}</div>
          <div className="gal-grid">
            {d.items.map(p => (
              <div key={p.id} className="gal-item"
                onClick={() => setOpen(filtered.indexOf(p))}>
                <img src={p.url} alt="" loading="lazy" />
                <span className="gal-who">{initials(p.author)}</span>
                {p.kind === "video" &&
                  <span className="gal-vid">&#9658; {p.duration_s ? fmtDur(p.duration_s) : ""}</span>}
                {!p.place_name && <span className="gal-noloc" title="No location">?</span>}
              </div>))}
          </div>
        </section>
      ))}
    </main>

    {cur && (
      <div className="lightbox" onClick={() => setOpen(null)}>
        <div className="lb-body" onClick={e => e.stopPropagation()}>
          {cur.kind === "video"
            ? <video src={cur.videoUrl} poster={cur.url} controls playsInline
                style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />
            : <img src={cur.url} alt="" />}
          <div className="lb-meta">
            <b>{cur.author}</b>
            <span>{new Date(cur.ts).toLocaleString()}</span>
            <span>{cur.place_name || "No location"}</span>
          </div>
          <div className="lb-actions">
            {open > 0 && <button onClick={() => setOpen(open - 1)}>&larr; Prev</button>}
            {open < filtered.length - 1 && <button onClick={() => setOpen(open + 1)}>Next &rarr;</button>}
            <button onClick={download}>Download original</button>
            {canEdit && <button onClick={setPlace}>Set place</button>}
            {canEdit && <button className="warn" onClick={del}>Delete</button>}
            <button onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      </div>
    )}
  </>);
}
