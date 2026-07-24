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
  const [bulkMode, setBulkMode] = useState(false);       // location bulk
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPlace, setBulkPlace] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [dateMode, setDateMode] = useState(false);        // date bulk
  const [dateSelected, setDateSelected] = useState(new Set());
  const [dateTab, setDateTab] = useState("date");         // "date" | "offset" | "anchor"
  const [dateNewDate, setDateNewDate] = useState("");     // YYYY-MM-DD
  const [dateOffset, setDateOffset] = useState(0);       // integer hours
  const [dateAnchor, setDateAnchor] = useState("");       // datetime-local string
  const [dateConfirm, setDateConfirm] = useState(false);
  const [dateBusy, setDateBusy] = useState(false);
  const [dateError, setDateError] = useState("");
  const [dateSummary, setDateSummary] = useState("");     // human-readable preview for confirm sheet
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

  function exitBulk() {
    setBulkMode(false); setBulkSelected(new Set());
    setBulkPlace(""); setBulkConfirm(false); setBulkError("");
  }
  function exitDateMode() {
    setDateMode(false); setDateSelected(new Set()); setDateTab("date");
    setDateNewDate(""); setDateOffset(0); setDateAnchor("");
    setDateConfirm(false); setDateBusy(false); setDateError(""); setDateSummary("");
  }
  function toggleDateSel(id) {
    setDateSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAllDate() {
    setDateSelected(new Set((items || []).map(p => p.id)));
  }
  // Compute new timestamps on the client where we know the browser timezone.
  function buildTimestamps() {
    const selected = (items || []).filter(p => dateSelected.has(p.id));
    if (!selected.length) return null;
    const result = {};

    if (dateTab === "date") {
      if (!dateNewDate) return null;
      const [y, mo, d] = dateNewDate.split("-").map(Number);
      for (const p of selected) {
        const old = new Date(p.ts);
        // Construct in local time: keep local HH:MM:SS, swap the date.
        const newTs = new Date(y, mo - 1, d,
          old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
        result[p.id] = newTs.toISOString();
      }
    } else if (dateTab === "offset") {
      const ms = dateOffset * 3600000;
      for (const p of selected) {
        result[p.id] = new Date(new Date(p.ts).getTime() + ms).toISOString();
      }
    } else if (dateTab === "anchor") {
      if (!dateAnchor) return null;
      const sorted = [...selected].sort((a, b) => new Date(a.ts) - new Date(b.ts));
      const earliest = sorted[0];
      const delta = new Date(dateAnchor).getTime() - new Date(earliest.ts).getTime();
      for (const p of selected) {
        result[p.id] = new Date(new Date(p.ts).getTime() + delta).toISOString();
      }
    }
    return result;
  }
  function openDateConfirm() {
    const ts = buildTimestamps();
    if (!ts) return;
    const count = Object.keys(ts).length;
    let summary = "";
    if (dateTab === "date") summary = `Change the date of ${count} photo${count !== 1 ? "s" : ""} to ${dateNewDate} (keeping each photo's original time).`;
    else if (dateTab === "offset") summary = `Shift ${count} photo${count !== 1 ? "s" : ""} by ${dateOffset > 0 ? "+" : ""}${dateOffset} hour${Math.abs(dateOffset) !== 1 ? "s" : ""}.`;
    else if (dateTab === "anchor") {
      const sorted = [...(items || [])].filter(p => dateSelected.has(p.id)).sort((a, b) => new Date(a.ts) - new Date(b.ts));
      const earliest = sorted[0];
      summary = `Move ${count} photo${count !== 1 ? "s" : ""} so the earliest (currently ${new Date(earliest.ts).toLocaleString()}) becomes ${new Date(dateAnchor).toLocaleString()}, preserving relative order.`;
    }
    setDateSummary(summary);
    setDateConfirm(true);
  }
  async function applyDateBulk() {
    setDateBusy(true); setDateError("");
    const timestamps = buildTimestamps();
    if (!timestamps) { setDateBusy(false); return; }
    const r = await fetch(`/api/trips/${tripId}/photos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamps }),
    });
    const j = await r.json();
    setDateBusy(false);
    if (!r.ok) { setDateError(j.error || "Something went wrong."); return; }
    exitDateMode();
    load();
  }
  function toggleBulk(id) {
    setBulkSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAllWithoutLocation() {
    const ids = (items || []).filter(p => !p.place_name && p.kind !== "video").map(p => p.id);
    setBulkSelected(new Set(ids));
  }
  async function applyBulkLocation() {
    setBulkBusy(true); setBulkError("");
    const r = await fetch(`/api/trips/${tripId}/photos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: [...bulkSelected], placeName: bulkPlace.trim() }),
    });
    const j = await r.json();
    setBulkBusy(false);
    if (!r.ok) { setBulkError(j.error || "Something went wrong."); return; }
    exitBulk();
    load();
  }

  if (items === null) return <main><p className="muted">Loading gallery...</p></main>;

  const uploading = queue.filter(x => x.state === "uploading" || x.state === "waiting").length;
  const errors = queue.filter(x => x.state === "error");

  const canManage = role === "owner" || role === "admin";

  return (<>
    <div className="topbar">
      <Link href={`/trip/${tripId}`} style={{ color: "#cfe3ec" }}>&larr; Timeline</Link>
      <span className="brand">Gallery</span>
      <span className="row" style={{ gap: 12 }}>
        {canManage && !bulkMode && !dateMode && (<>
          <a role="button" tabIndex={0} style={{ color: "#cfe3ec", cursor: "pointer", fontSize: "0.9rem" }}
            onClick={() => setBulkMode(true)}>Edit locations</a>
          <a role="button" tabIndex={0} style={{ color: "#cfe3ec", cursor: "pointer", fontSize: "0.9rem" }}
            onClick={() => setDateMode(true)}>Edit dates</a>
        </>)}
        {bulkMode && (
          <a role="button" tabIndex={0} style={{ color: "#cfe3ec", cursor: "pointer", fontSize: "0.9rem" }}
            onClick={exitBulk}>Cancel</a>)}
        {dateMode && (
          <a role="button" tabIndex={0} style={{ color: "#cfe3ec", cursor: "pointer", fontSize: "0.9rem" }}
            onClick={exitDateMode}>Cancel</a>)}
        {role !== "viewer" && !bulkMode && !dateMode
          ? <a role="button" tabIndex={0} style={{ color: "#f2b441", fontWeight: 700, cursor: "pointer" }}
              onClick={() => fileRef.current?.click()}>Upload</a>
          : <span />}
      </span>
    </div>
    <input ref={fileRef} type="file" multiple hidden
      accept="image/*,video/mp4,video/quicktime,video/webm" onChange={onPick} />
    <main className="wide">
      <div className="row gal-filter">
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter gallery"
          disabled={bulkMode}>
          <option value="all">Everyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="untagged">No location</option>
        </select>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
          {uploading > 0 && ` | uploading ${uploading}...`}</span>
      </div>
      {bulkMode && (
        <div className="row" style={{ gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
          <button className="small secondary" onClick={selectAllWithoutLocation}>
            Select all without location</button>
          {bulkSelected.size > 0 && (
            <button className="small secondary" onClick={() => setBulkSelected(new Set())}>
              Clear ({bulkSelected.size} selected)</button>)}
          {bulkSelected.size === 0 && (
            <span className="muted" style={{ fontSize: "0.85rem", alignSelf: "center" }}>
              Tap photos to select them, or use the button above.</span>)}
        </div>
      )}
      {dateMode && (
        <div className="row" style={{ gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
          <button className="small secondary" onClick={selectAllDate}>Select all</button>
          {dateSelected.size > 0 && (
            <button className="small secondary" onClick={() => setDateSelected(new Set())}>
              Clear ({dateSelected.size} selected)</button>)}
          {dateSelected.size === 0 && (
            <span className="muted" style={{ fontSize: "0.85rem", alignSelf: "center" }}>
              Tap photos to select them, or use Select all.</span>)}
        </div>
      )}
      {errors.map((x, i) => <p key={i} className="error">{x.name}: {x.err}</p>)}

      {days.length === 0 && (
        <div className="card"><b>Nothing here yet</b>
          <p className="muted">Upload from your camera roll, or capture from the
            timeline. Photos land under the day they were taken.</p></div>)}

      {days.map(d => (
        <section key={d.key}>
          <div className="day-tag">{d.label}</div>
          <div className="gal-grid">
            {d.items.map(p => {
              const isLocSel = bulkSelected.has(p.id);
              const isDateSel = dateSelected.has(p.id);
              const inBulk = bulkMode && p.kind !== "video";
              const inDate = dateMode;
              return (
                <div key={p.id}
                  className={`gal-item${inBulk ? " gal-bulk" : ""}${isLocSel ? " gal-sel" : ""}${inDate && !inBulk ? " gal-bulk" : ""}${isDateSel && !isLocSel ? " gal-sel" : ""}`}
                  onClick={() => {
                    if (inBulk) return toggleBulk(p.id);
                    if (inDate) return toggleDateSel(p.id);
                    setOpen(filtered.indexOf(p));
                  }}>
                  <img src={p.url} alt="" loading="lazy" />
                  <span className="gal-who">{initials(p.author)}</span>
                  {p.kind === "video" &&
                    <span className="gal-vid">&#9658; {p.duration_s ? fmtDur(p.duration_s) : ""}</span>}
                  {!p.place_name && <span className="gal-noloc" title="No location">?</span>}
                  {(inBulk || inDate) && (
                    <span className="gal-check">{(isLocSel || isDateSel) ? "✓" : ""}</span>)}
                </div>);
            })}
          </div>
        </section>
      ))}
    </main>

    {dateMode && dateSelected.size > 0 && !dateConfirm && (
      <div className="bulk-bar" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div className="row" style={{ gap: 0, background: "rgba(255,255,255,0.08)", borderRadius: 10, overflow: "hidden" }}>
          {[["date","Date"],["offset","Hour offset"],["anchor","Anchor"]].map(([val, label]) => (
            <button key={val} onClick={() => setDateTab(val)}
              style={{ flex: 1, borderRadius: 0, padding: "9px 4px", fontSize: "0.82rem",
                background: dateTab === val ? "var(--tide)" : "transparent",
                color: "#fff", fontWeight: dateTab === val ? 700 : 400, border: "none" }}>
              {label}
            </button>))}
        </div>
        {dateTab === "date" && (
          <div className="row" style={{ gap: 10 }}>
            <input type="date" value={dateNewDate} onChange={e => setDateNewDate(e.target.value)}
              style={{ flex: 1, minWidth: 0 }} />
            <button disabled={!dateNewDate} onClick={openDateConfirm}
              style={{ width: "auto", padding: "10px 16px", fontSize: "0.9rem", flexShrink: 0 }}>
              Apply to {dateSelected.size}</button>
          </div>
        )}
        {dateTab === "offset" && (
          <div className="row" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, flex: 1 }}>
              <button onClick={() => setDateOffset(h => h - 1)}
                style={{ width: 40, padding: "10px 0", flexShrink: 0 }}>−</button>
              <span style={{ color: "#fff", fontWeight: 700, minWidth: 80, textAlign: "center" }}>
                {dateOffset > 0 ? "+" : ""}{dateOffset}h</span>
              <button onClick={() => setDateOffset(h => h + 1)}
                style={{ width: 40, padding: "10px 0", flexShrink: 0 }}>+</button>
            </div>
            <button disabled={dateOffset === 0} onClick={openDateConfirm}
              style={{ width: "auto", padding: "10px 16px", fontSize: "0.9rem", flexShrink: 0 }}>
              Apply to {dateSelected.size}</button>
          </div>
        )}
        {dateTab === "anchor" && (
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
                Set earliest selected photo to:</div>
              <input type="datetime-local" value={dateAnchor} onChange={e => setDateAnchor(e.target.value)}
                style={{ width: "100%" }} />
            </div>
            <button disabled={!dateAnchor} onClick={openDateConfirm}
              style={{ width: "auto", padding: "10px 16px", fontSize: "0.9rem", flexShrink: 0, alignSelf: "flex-end" }}>
              Apply to {dateSelected.size}</button>
          </div>
        )}
      </div>
    )}
    {dateConfirm && (
      <div className="lightbox" onClick={() => setDateConfirm(false)}>
        <div className="pm-sheet" onClick={e => e.stopPropagation()}>
          <b>Confirm date update</b>
          <p style={{ margin: "10px 0 16px", lineHeight: 1.5 }}>{dateSummary}</p>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: "0.85rem" }}>
            Original timestamps are preserved in the audit trail and visible in the lightbox.
          </p>
          {dateError && <p className="error">{dateError}</p>}
          <button onClick={applyDateBulk} disabled={dateBusy}>
            {dateBusy ? "Applying..." : "Yes, update timestamps"}</button>
          <button className="ghost" onClick={() => { setDateConfirm(false); setDateError(""); }}>Cancel</button>
        </div>
      </div>
    )}
    {bulkMode && bulkSelected.size > 0 && !bulkConfirm && (
      <div className="bulk-bar">
        <span style={{ fontWeight: 600 }}>{bulkSelected.size} photo{bulkSelected.size !== 1 ? "s" : ""} selected</span>
        <input type="text" value={bulkPlace} placeholder="e.g. Amsterdam, Netherlands"
          onChange={e => setBulkPlace(e.target.value)}
          style={{ flex: 1, minWidth: 0 }} />
        <button disabled={!bulkPlace.trim()}
          onClick={() => setBulkConfirm(true)}>Apply location</button>
      </div>
    )}
    {bulkConfirm && (
      <div className="lightbox" onClick={() => setBulkConfirm(false)}>
        <div className="pm-sheet" onClick={e => e.stopPropagation()}>
          <b>Confirm bulk location update</b>
          <p style={{ margin: "10px 0", lineHeight: 1.5 }}>
            Set the location of <b>{bulkSelected.size} photo{bulkSelected.size !== 1 ? "s" : ""}</b> to:
          </p>
          <p style={{ margin: "0 0 16px", fontStyle: "italic", color: "var(--tide)" }}>
            &ldquo;{bulkPlace.trim()}&rdquo;
          </p>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: "0.85rem" }}>
            Original locations are preserved and visible in the lightbox. You can re-edit any photo individually using the Set place button.
          </p>
          {bulkError && <p className="error">{bulkError}</p>}
          <button onClick={applyBulkLocation} disabled={bulkBusy}>
            {bulkBusy ? "Applying..." : `Yes, update ${bulkSelected.size} photo${bulkSelected.size !== 1 ? "s" : ""}`}</button>
          <button className="ghost" onClick={() => { setBulkConfirm(false); setBulkError(""); }}>Cancel</button>
        </div>
      </div>
    )}
    {cur && (
      <div className="lightbox" onClick={() => setOpen(null)}>
        <div className="lb-body" onClick={e => e.stopPropagation()}>
          {cur.kind === "video"
            ? <video src={cur.videoUrl} poster={cur.fullUrl || cur.url} controls playsInline
                style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />
            : <img src={cur.fullUrl || cur.url} alt="" />}
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
