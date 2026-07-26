"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { queueItem, flushOutbox, installFlushTriggers, outboxCount,
  outboxSummary, clearOutbox, compressImage, getPosition } from "@/lib/outbox";

const initials = (n) => (n || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const dayKey = (ts) => new Date(ts).toLocaleDateString(undefined,
  { weekday: "long", month: "long", day: "numeric" });
const fmtTs = (ts) => new Date(ts).toLocaleString([], {
  month: "2-digit", day: "2-digit", year: "numeric",
  hour: "numeric", minute: "2-digit" });
// Converts an ISO timestamp to the format datetime-local inputs expect (no seconds, no Z).
const toDatetimeLocal = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

export default function TripView({ tripId }) {
  const [trip, setTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [items, setItems] = useState([]);
  const [person, setPerson] = useState("");
  const [pending, setPending] = useState(0);
  const [pendingSummary, setPendingSummary] = useState({ photos: 0, notes: 0 });
  const [note, setNote] = useState("");
  const [attached, setAttached] = useState([]); // photoIds already uploaded, attached to next note
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [myRole, setMyRole] = useState("member");
  const [siteAdmin, setSiteAdmin] = useState(false);
  const [editing, setEditing] = useState(null);      // entry id being edited
  const [editText, setEditText] = useState("");
  const [editTs, setEditTs] = useState("");           // datetime-local string
  const [editLocation, setEditLocation] = useState(""); // place name text
  const [lb, setLb] = useState(null);                 // {list:[photo], i} lightbox
  const [selecting, setSelecting] = useState(false);  // group-photos mode
  const [selected, setSelected] = useState([]);       // photoIds picked for grouping
  const [groupMeta, setGroupMeta] = useState(null);   // {ts,lat,lng} carried onto the note
  const [photoMenu, setPhotoMenu] = useState(null);    // photoId: ungroup-or-delete sheet
  const [photoEdit, setPhotoEdit] = useState(null);    // {id, placeName}: location edit sheet
  const [pickingNote, setPickingNote] = useState(false); // choosing a note to add selection to
  const [noteOpen, setNoteOpen] = useState(false);   // note composer popup
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const fileRef = useRef(null);
  const libraryRef = useRef(null);

  const loadTimeline = useCallback(async () => {
    const r = await fetch(`/api/trips/${tripId}/timeline${person ? `?person=${person}` : ""}`);
    if (r.ok) setItems((await r.json()).items);
  }, [tripId, person]);

  useEffect(() => {
    fetch(`/api/trips/${tripId}`).then(r => r.json()).then(d => {
      setTrip(d.trip); setMembers(d.members || []);
      setMe(d.me); setSiteAdmin(!!d.siteAdmin);
      setMyRole(d.trip?.my_role || "member");
      setLocationPromptDismissed(!!d.trip?.location_prompt_dismissed);
    });
  }, [tripId]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);
  useEffect(() => {
    const updatePending = async (count) => {
      setPending(count ?? await outboxCount());
      setPendingSummary(await outboxSummary());
    };
    installFlushTriggers(updatePending);
    updatePending();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadTimeline();
    }, 30000);
    return () => clearInterval(poll);
  }, [loadTimeline]);

  // Live updates: reload when anyone in the trip adds or changes something.
  // EventSource reconnects on its own; the 30s poll above is the backstop.
  useEffect(() => {
    const es = new EventSource(`/api/trips/${tripId}/events`);
    es.onmessage = (e) => {
      try { if (JSON.parse(e.data).type === "update") loadTimeline(); } catch {}
    };
    return () => es.close();
  }, [tripId, loadTimeline]);

  const canModerate = myRole === "owner" || myRole === "admin" || siteAdmin;
  const viewer = myRole === "viewer" && !siteAdmin;
  const mine = (it) => Number(it.user_id) === Number(me);

  function openLb(list, id) {
    const i = list.findIndex(p => Number(p.id) === Number(id));
    if (i >= 0) setLb({ list, i });
  }
  function toggleSel(photoId) {
    setSelected(sel => sel.includes(photoId)
      ? sel.filter(x => x !== photoId) : [...sel, photoId]);
  }
  async function addSelectionToNote(entryId) {
    const ids = [...selected];
    setPickingNote(false); setSelecting(false); setSelected([]);
    const r = await fetch(`/api/entries/${entryId}/photos`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: ids }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    loadTimeline();
  }
  function annotateSelection(loosePhotos) {
    const chosen = loosePhotos.filter(p => selected.includes(Number(p.id)));
    if (!chosen.length) return;
    const first = [...chosen].sort((a, b) => new Date(a.ts) - new Date(b.ts))[0];
    setAttached(selected);
    setGroupMeta({ ts: first.ts, lat: first.lat ?? null, lng: first.lng ?? null });
    setSelecting(false); setSelected([]);
    setNoteOpen(true);
  }
  async function downloadOriginal(id) {
    const j = await fetch(`/api/photos/${id}`).then(r => r.json());
    if (j.url) window.location.href = j.url;
  }

  async function saveEdit(entryId, originalTs) {
    const tsChanged = editTs && editTs !== toDatetimeLocal(originalTs);
    const locChanged = editLocation.trim() !== "";
    const r = await fetch(`/api/entries/${entryId}`, { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: editText,
        ...(tsChanged ? { ts: new Date(editTs).toISOString() } : {}),
        ...(locChanged ? { location: editLocation.trim() } : {}),
      }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    setEditing(null); setEditText(""); setEditTs(""); setEditLocation("");
    loadTimeline();
  }
  async function deleteEntry(entryId) {
    if (!confirm("Delete this note for everyone? Photos attached to it stay in the trip.")) return;
    const r = await fetch(`/api/entries/${entryId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error); return; }
    loadTimeline();
  }
  async function savePhotoLocation() {
    const r = await fetch(`/api/photos/${photoEdit.id}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeName: photoEdit.placeName }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    setPhotoEdit(null);
    loadTimeline();
  }
  async function dismissLocationPrompt() {
    setShowLocationPrompt(false);
    setLocationPromptDismissed(true);
    await fetch(`/api/trips/${tripId}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissLocationPrompt: true }) });
  }

  async function ungroupPhoto(photoId) {
    setPhotoMenu(null);
    const r = await fetch(`/api/photos/${photoId}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ungroup: true }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    loadTimeline();
  }
  async function deletePhoto(photoId) {
    if (!confirm("Delete this photo for everyone? If it is in the book, it will be removed from those pages too.")) return;
    const r = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error); return; }
    loadTimeline();
  }

  async function onFiles(e, source = "capture") {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    let hadMissingLocation = false;
    try {
    // Camera shots: tag with device location, taken-now. Library picks:
    // trust the file's own EXIF (date + GPS); never the device location,
    // which would geotag last week's beach photos with the living room.
    const pos = source === "capture" ? await getPosition() : {};
    for (const f of files) {
      let exif = {};
      if (source === "library" && f.type === "image/jpeg") {
        try { exif = await readJpegExif(f); } catch {}
      }
      if (source === "library" && exif.lat == null) hadMissingLocation = true;
      const blob = await compressImage(f);
      const contentType = blob.type || f.type || "image/jpeg";
      const meta = { tripId: Number(tripId), contentType, source,
        ts: (exif.takenAt || new Date(f.lastModified || Date.now())).toISOString(),
        ...(source === "capture" ? pos
          : { lat: exif.lat ?? null, lng: exif.lng ?? null }) };
      if (navigator.onLine) {
        try {
          const pre = await fetch("/api/photos/presign", { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
          if (!pre.ok) throw new Error();
          const { photoId, putUrl } = await pre.json();
          const put = await fetch(putUrl, { method: "PUT",
            headers: { "Content-Type": contentType }, body: blob });
          if (!put.ok) throw new Error();
          await fetch("/api/photos/complete", { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId }) });
          setAttached(a => [...a, photoId]);
          continue;
        } catch { /* fall through to queue */ }
      }
      await queueItem({ kind: "photo", meta, blob });
      setPending(await outboxCount());
    }
    } catch (err) {
      alert("Could not add that photo: " + (err?.message || err));
    } finally {
      setBusy(false);
      loadTimeline();
      if (source === "library" && hadMissingLocation && !locationPromptDismissed) {
        setShowLocationPrompt(true);
      }
    }
  }

  async function saveNote() {
    const payload = {
      tripId: Number(tripId), clientId: crypto.randomUUID(),
      ts: groupMeta?.ts || new Date().toISOString(), text: note, photoIds: attached,
      ...(groupMeta ? { lat: groupMeta.lat, lng: groupMeta.lng } : await getPosition())
    };
    setNote(""); setAttached([]); setGroupMeta(null); setNoteOpen(false);
    if (navigator.onLine) {
      const r = await fetch("/api/entries", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { loadTimeline(); return; }
    }
    await queueItem({ kind: "entry", payload });
    setPending(await outboxCount());
  }

  // Dictation: iOS keyboard mic works in the textarea; the in-app Web Speech
  // button was removed (unreliable on iOS Safari, redundant with the keyboard).


  const days = [];
  for (const it of items) {
    const k = dayKey(it.ts);
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, items: [] });
    days[days.length - 1].items.push(it);
  }

  return (
    <>
      <div className="trip-head">
      <div className="topbar tb2">
        <div className="tb-row">
          <Link href="/" style={{ color: "#cfe3ec" }}>&larr; Trips</Link>
          <span className="row" style={{ gap: 14 }}>
            <Link href={`/trip/${tripId}/gallery`} style={{ color: "#cfe3ec" }}>Gallery</Link>
            {(myRole === "owner" || myRole === "admin" || siteAdmin) &&
              <Link href={`/trip/${tripId}/settings`} style={{ color: "#cfe3ec" }}>Settings</Link>}
            {myRole !== "viewer" &&
              <Link href={`/trip/${tripId}/book`} style={{ color: "#f2b441", fontWeight: 700 }}>Book</Link>}
          </span>
        </div>
        <div className="tb-name">{trip?.name || ""}</div>
      </div>
      <div className="trip-filter row">
        <select aria-label="Filter by person" value={person}
          onChange={e => setPerson(e.target.value)}>
          <option value="">Everyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select>
        {myRole !== "viewer" &&
          <button className="small secondary"
            onClick={() => { setSelecting(v => !v); setSelected([]); setPickingNote(false); }}>
            {selecting ? "Cancel" : "Group"}</button>}
      </div>
      </div>
      {pending > 0 && <div className="sync-chip" role="status">
        <span>
          {[
            pendingSummary.photos > 0 && `${pendingSummary.photos} photo${pendingSummary.photos > 1 ? "s" : ""}`,
            pendingSummary.notes > 0 && `${pendingSummary.notes} note${pendingSummary.notes > 1 ? "s" : ""}`,
          ].filter(Boolean).join(" + ") || `${pending} item${pending > 1 ? "s" : ""}`} waiting to upload — keep the app open on WiFi.
        </span>
        <button className="sync-retry" onClick={() => flushOutbox(async (n) => {
          setPending(n); setPendingSummary(await outboxSummary());
        })}>Retry</button>
        <button className="sync-retry sync-clear" onClick={async () => {
          await clearOutbox();
          setPending(0); setPendingSummary({ total: 0, photos: 0, notes: 0 });
        }}>Clear</button>
      </div>}
      <main>

        {days.length === 0 && (
          <div className="card"><b>Nothing here yet</b>
            <p className="muted">Add the first photo or note with the bar below.</p></div>
        )}
        {days.map(d => (
          <section key={d.key}>
            <div className="day-tag">{d.key}</div>
            {d.items.map(it => (
              <article key={`${it.type}-${it.id}`} className="feed-item">
                <div className="avatar" aria-hidden>{initials(it.author)}</div>
                <div className={`bubble ${pickingNote && it.type === "entry" ? "pick-target" : ""}`}
                  onClick={pickingNote && it.type === "entry"
                    ? () => addSelectionToNote(it.id) : undefined}>
                  {it.type === "entry" ? (
                    editing === it.id ? (
                      <>
                        <textarea rows={3} value={editText} autoFocus
                          onChange={e => setEditText(e.target.value)} />
                        <label className="edit-label">Date &amp; time</label>
                        <input type="datetime-local" value={editTs}
                          onChange={e => setEditTs(e.target.value)} />
                        <label className="edit-label">Location</label>
                        <input type="text" value={editLocation} placeholder="e.g. Paris, France"
                          onChange={e => setEditLocation(e.target.value)} />
                        <div className="row" style={{ marginTop: 6 }}>
                          <button className="small" onClick={() => saveEdit(it.id, it.original_ts || it.ts)}
                            disabled={!editText.trim()}>Save</button>
                          <button className="small secondary"
                            onClick={() => { setEditing(null); setEditText(""); setEditTs(""); setEditLocation(""); }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        {it.text && <div style={{ whiteSpace: "pre-wrap" }}>{it.text}</div>}
                        {it.photos?.length > 0 && (
                          <div className="photo-grid">
                            {it.photos.map(p => (
                              <span key={p.id} className="pwrap"
                                onClick={() => openLb(it.photos, p.id)}>
                                <img src={p.url} alt="" loading="lazy" />
                                <div className="photo-hover-meta">
                                  {p.author} &middot; {new Date(p.ts).toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" })}
                                  {p.place_name ? ` · ${p.place_name}` : " · No Location"}
                                </div>
                                {(mine(p) || canModerate) && <>
                                  <button className="pdel" aria-label="Photo options"
                                    onClick={e => { e.stopPropagation(); setPhotoMenu(Number(p.id)); }}>&times;</button>
                                  <button className="pedit" aria-label="Edit photo location"
                                    onClick={e => { e.stopPropagation(); setPhotoEdit({ id: Number(p.id), placeName: p.place_name || "" }); }}>✎</button>
                                </>}
                              </span>))}
                          </div>
                        )}
                      </>
                    )
                  ) : (
                    <span className={`pwrap ${selecting && selected.includes(Number(it.id)) ? "psel" : ""} ${selecting && !mine(it) ? "pdim" : ""}`}
                      onClick={() => selecting
                        ? (mine(it) && toggleSel(Number(it.id)))
                        : openLb(d.items.filter(x => x.type === "photo"), it.id)}>
                      <img src={it.url} alt="" loading="lazy" />
                      <div className="photo-hover-meta">
                        {it.author} &middot; {new Date(it.ts).toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" })}
                        {it.place_name ? ` · ${it.place_name}` : " · No Location"}
                      </div>
                      {selecting && selected.includes(Number(it.id)) &&
                        <span className="pcheck">&#10003;</span>}
                      {!selecting && (mine(it) || canModerate) && <>
                        <button className="pdel" aria-label="Delete photo"
                          onClick={e => { e.stopPropagation(); deletePhoto(it.id); }}>&times;</button>
                        <button className="pedit" aria-label="Edit photo location"
                          onClick={e => { e.stopPropagation(); setPhotoEdit({ id: Number(it.id), placeName: it.place_name || "" }); }}>✎</button>
                      </>}
                    </span>
                  )}
                  <div className="meta">
                    {it.type === "entry" ? (<>
                      <div className="meta-row">
                        <span className="meta-label">Created:</span>
                        {it.author} &middot; {fmtTs(it.original_ts || it.ts)}
                        {(it.original_place_name || (!it.ts_source || it.ts_source === "original" ? it.place_name : null))
                          ? <> &middot; {it.original_place_name || it.place_name}</>
                          : null}
                      </div>
                      {it.ts_source && it.ts_source !== "original" && (
                        <div className="meta-row meta-updated">
                          <span className="meta-label">Updated:</span>
                          {it.ts_source === "photo" ? "Photo driven" : "Manually updated"} &middot; {fmtTs(it.ts)}
                          {it.place_name ? <> &middot; {it.place_name}</> : null}
                        </div>
                      )}
                      {editing !== it.id && (mine(it) || canModerate) && (
                        <span className="act-links">
                          <a role="button" tabIndex={0}
                            onClick={() => {
                              setEditing(it.id);
                              setEditText(it.text || "");
                              setEditTs(toDatetimeLocal(it.ts));
                              setEditLocation(it.place_name || "");
                            }}>Edit</a>
                          <a role="button" tabIndex={0}
                            onClick={() => deleteEntry(it.id)}>Delete</a>
                        </span>
                      )}
                    </>) : (<>
                      {it.author} &middot; {new Date(it.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      {it.place_name ? <> &middot; {it.place_name}</> : null}
                    </>)}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))}

        {viewer && (
          <p className="muted" style={{ textAlign: "center", margin: "14px 0" }}>
            You are following this trip as a viewer. New photos and notes
            appear here live.</p>
        )}
      </main>

      {selecting && (
        <div className="grp-bar">
          {pickingNote
            ? <span>Now tap the note to add {selected.length} photo{selected.length > 1 ? "s" : ""} to.
                <button className="ghost" onClick={() => setPickingNote(false)}>Back</button></span>
            : selected.length === 0
            ? <span>Tap your loose photos to select them.</span>
            : <>
                <button onClick={() => {
                  const loose = items.filter(x => x.type === "photo");
                  annotateSelection(loose);
                }}>New note</button>
                <button onClick={() => setPickingNote(true)}>Add to a note</button>
              </>}
        </div>
      )}
      {noteOpen && !viewer && (
        <div className="lightbox" onClick={() => setNoteOpen(false)}>
          <div className="pm-sheet" onClick={e => e.stopPropagation()}>
            <b>Add a note{attached.length ? ` (${attached.length} photo${attached.length > 1 ? "s" : ""} attached)` : ""}</b>
            <textarea id="note" rows={4} autoFocus value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="What happened? Tip: the mic on your keyboard works great here." />
            <button onClick={saveNote} disabled={!note.trim() && !attached.length}>Save note</button>
            <button className="ghost" onClick={() => {
              setNoteOpen(false);
              if (groupMeta) { setAttached([]); setGroupMeta(null); }
            }}>Cancel</button>
          </div>
        </div>
      )}
      {photoMenu && (
        <div className="lightbox" onClick={() => setPhotoMenu(null)}>
          <div className="pm-sheet" onClick={e => e.stopPropagation()}>
            <b>This photo is part of a note</b>
            <button onClick={() => ungroupPhoto(photoMenu)}>
              Ungroup: back to the timeline on its own</button>
            <button className="danger" onClick={() => { const id = photoMenu; setPhotoMenu(null); deletePhoto(id); }}>
              Delete: remove from the trip for everyone</button>
            <button className="ghost" onClick={() => setPhotoMenu(null)}>Cancel</button>
          </div>
        </div>
      )}
      {photoEdit && (
        <div className="lightbox" onClick={() => setPhotoEdit(null)}>
          <div className="pm-sheet" onClick={e => e.stopPropagation()}>
            <b>Edit photo location</b>
            <label className="edit-label">Search for a place</label>
            <input type="text" value={photoEdit.placeName}
              placeholder="e.g. Paris, France"
              onChange={e => setPhotoEdit({ ...photoEdit, placeName: e.target.value })} />
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: "0.8rem" }}>
              Type a place name and we&apos;ll look up the coordinates automatically.
            </p>
            <button onClick={savePhotoLocation} disabled={!photoEdit.placeName.trim()}>Save</button>
            <button className="ghost" onClick={() => setPhotoEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
      {lb && (
        <div className="lightbox" onClick={() => setLb(null)}>
          <div className="lb-body" onClick={e => e.stopPropagation()}>
            <img src={lb.list[lb.i].fullUrl || lb.list[lb.i].url} alt="" />
            <div className="lb-meta">
              <span>
                <b>{lb.list[lb.i].author}</b>
                {" · "}{new Date(lb.list[lb.i].ts).toLocaleString()}
                {lb.list[lb.i].location_updated_by ? (<>
                  {" · "}{lb.list[lb.i].original_place_name || "No Location"}
                  {" · Updated Location ("}{lb.list[lb.i].location_updated_by}{"): "}
                  {lb.list[lb.i].place_name}
                </>) : lb.list[lb.i].place_name ? (
                  <>{" · "}{lb.list[lb.i].place_name}</>
                ) : null}
              </span>
            </div>
            <div className="lb-actions">
              {lb.i > 0 && <button onClick={() => setLb({ ...lb, i: lb.i - 1 })}>&larr; Prev</button>}
              {lb.i < lb.list.length - 1 && <button onClick={() => setLb({ ...lb, i: lb.i + 1 })}>Next &rarr;</button>}
              <button onClick={() => downloadOriginal(lb.list[lb.i].id)}>Download</button>
              <button onClick={() => setLb(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {showLocationPrompt && (
        <div className="lightbox" onClick={() => { setShowLocationPrompt(false); }}>
          <div className="pm-sheet" onClick={e => e.stopPropagation()}>
            <b>Some photos are missing location</b>
            <p style={{ margin: "8px 0", lineHeight: 1.5 }}>
              Some of your photos are missing location information. To include
              location on future uploads, go to:
            </p>
            <p style={{ margin: "8px 0", lineHeight: 1.5 }}>
              <b>Settings → Privacy &amp; Security → Location Services → Photos</b>
              {" "}and select <b>While Using App</b> or <b>Always</b>.
            </p>
            <p style={{ margin: "8px 0 16px", lineHeight: 1.5 }}>
              You can still add locations manually using the ✎ button on any photo.
            </p>
            <button onClick={dismissLocationPrompt}>Got it</button>
            <button className="ghost" onClick={dismissLocationPrompt}>Maybe later</button>
          </div>
        </div>
      )}
      {!viewer && <div className="capture-bar three">
        <button className="cb-side" onClick={() => libraryRef.current?.click()} disabled={busy}>
          {busy ? "Adding..." : "Add photos"}
        </button>
        <button className="cb-camera" onClick={() => fileRef.current?.click()} disabled={busy}
          aria-label="Open the camera">Camera</button>
        <button className="cb-side" onClick={() => setNoteOpen(true)}>Add note</button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          multiple hidden onChange={e => onFiles(e, "capture")} />
        <input ref={libraryRef} type="file" accept="image/*"
          multiple hidden onChange={e => onFiles(e, "library")} />
      </div>}
    </>
  );
}
