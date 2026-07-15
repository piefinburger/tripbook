"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { queueItem, flushOutbox, installFlushTriggers, outboxCount,
  compressImage, getPosition } from "@/lib/outbox";

const initials = (n) => (n || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const dayKey = (ts) => new Date(ts).toLocaleDateString(undefined,
  { weekday: "long", month: "long", day: "numeric" });

export default function TripView({ tripId }) {
  const [trip, setTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [items, setItems] = useState([]);
  const [person, setPerson] = useState("");
  const [pending, setPending] = useState(0);
  const [note, setNote] = useState("");
  const [attached, setAttached] = useState([]); // photoIds already uploaded, attached to next note
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [myRole, setMyRole] = useState("member");
  const [siteAdmin, setSiteAdmin] = useState(false);
  const [editing, setEditing] = useState(null);      // entry id being edited
  const [editText, setEditText] = useState("");
  const [lb, setLb] = useState(null);                 // {list:[photo], i} lightbox
  const [selecting, setSelecting] = useState(false);  // group-photos mode
  const [selected, setSelected] = useState([]);       // photoIds picked for grouping
  const [groupMeta, setGroupMeta] = useState(null);   // {ts,lat,lng} carried onto the note
  const [photoMenu, setPhotoMenu] = useState(null);    // photoId: ungroup-or-delete sheet
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteMsg, setInviteMsg] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const fileRef = useRef(null);

  const loadTimeline = useCallback(async () => {
    const r = await fetch(`/api/trips/${tripId}/timeline${person ? `?person=${person}` : ""}`);
    if (r.ok) setItems((await r.json()).items);
  }, [tripId, person]);

  useEffect(() => {
    fetch(`/api/trips/${tripId}`).then(r => r.json()).then(d => {
      setTrip(d.trip); setMembers(d.members || []);
      setMe(d.me); setSiteAdmin(!!d.siteAdmin);
      setMyRole(d.trip?.my_role || "member");
    });
  }, [tripId]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);
  useEffect(() => {
    installFlushTriggers(setPending);
    outboxCount().then(setPending);
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
  function annotateSelection(loosePhotos) {
    const chosen = loosePhotos.filter(p => selected.includes(Number(p.id)));
    if (!chosen.length) return;
    const first = [...chosen].sort((a, b) => new Date(a.ts) - new Date(b.ts))[0];
    setAttached(selected);
    setGroupMeta({ ts: first.ts, lat: first.lat ?? null, lng: first.lng ?? null });
    setSelecting(false); setSelected([]);
    setTimeout(() => document.getElementById("note")?.focus(), 50);
  }
  async function downloadOriginal(id) {
    const j = await fetch(`/api/photos/${id}`).then(r => r.json());
    if (j.url) window.location.href = j.url;
  }

  async function saveEdit(entryId) {
    const r = await fetch(`/api/entries/${entryId}`, { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: editText }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    setEditing(null); setEditText("");
    loadTimeline();
  }
  async function deleteEntry(entryId) {
    if (!confirm("Delete this note for everyone? Photos attached to it stay in the trip.")) return;
    const r = await fetch(`/api/entries/${entryId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error); return; }
    loadTimeline();
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

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
    const pos = await getPosition();
    for (const f of files) {
      const blob = await compressImage(f);
      const contentType = blob.type || f.type || "image/jpeg";
      const meta = { tripId: Number(tripId), contentType,
        ts: new Date(f.lastModified || Date.now()).toISOString(), ...pos };
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
    }
  }

  async function saveNote() {
    const payload = {
      tripId: Number(tripId), clientId: crypto.randomUUID(),
      ts: groupMeta?.ts || new Date().toISOString(), text: note, photoIds: attached,
      ...(groupMeta ? { lat: groupMeta.lat, lng: groupMeta.lng } : await getPosition())
    };
    setNote(""); setAttached([]); setGroupMeta(null);
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

  async function sendInvite() {
    setInviteMsg("");
    const r = await fetch(`/api/trips/${tripId}/invite`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
    setInviteMsg(r.ok ? `${inviteRole === "viewer" ? "Viewer" : "Contributor"} invite sent to ${inviteEmail}.` : (await r.json()).error);
    if (r.ok) setInviteEmail("");
  }

  const joinUrl = trip ? `${location.origin}/join/${trip.invite_code}` : "";
  const days = [];
  for (const it of items) {
    const k = dayKey(it.ts);
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, items: [] });
    days[days.length - 1].items.push(it);
  }

  return (
    <>
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
      {pending > 0 && <div className="sync-chip" role="status">
        {pending} item{pending > 1 ? "s" : ""} waiting to sync. Keep the app open on WiFi.
      </div>}
      <main>
        <div className="row" style={{ marginBottom: 8 }}>
          <select aria-label="Filter by person" value={person}
            onChange={e => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
          {myRole !== "viewer" &&
            <button className="small secondary" onClick={() => setShowInvite(s => !s)}>Invite</button>}
          {myRole !== "viewer" &&
            <button className="small secondary"
              onClick={() => { setSelecting(v => !v); setSelected([]); }}>
              {selecting ? "Cancel" : "Group"}</button>}
        </div>

        {showInvite && (
          <div className="card">
            <b>Invite family</b>
            <p className="muted" style={{ margin: "4px 0" }}>Share this link (works
            as a QR code via the iOS share sheet):</p>
            <input readOnly value={joinUrl} onFocus={e => e.target.select()} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => navigator.share?.({ url: joinUrl })
                ?? navigator.clipboard.writeText(joinUrl)}>Share link</button>
            </div>
            <label htmlFor="invemail">Or email an invite</label>
            <div className="row">
              <input id="invemail" type="email" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} placeholder="grandma@example.com" />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                aria-label="Invite role" style={{ width: "auto" }}>
                <option value="member">Contributor: adds photos and notes</option>
                <option value="viewer">Viewer: watches live, adds nothing</option>
              </select>
              <button className="small" onClick={sendInvite} disabled={!inviteEmail}>Send</button>
            </div>
            {inviteMsg && <p className="muted">{inviteMsg}</p>}
          </div>
        )}

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
                <div className="bubble">
                  {it.type === "entry" ? (
                    editing === it.id ? (
                      <>
                        <textarea rows={3} value={editText} autoFocus
                          onChange={e => setEditText(e.target.value)} />
                        <div className="row" style={{ marginTop: 6 }}>
                          <button className="small" onClick={() => saveEdit(it.id)}
                            disabled={!editText.trim()}>Save</button>
                          <button className="small secondary"
                            onClick={() => { setEditing(null); setEditText(""); }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        {it.text && <div>{it.text}</div>}
                        {it.photos?.length > 0 && (
                          <div className="photo-grid">
                            {it.photos.map(p => (
                              <span key={p.id} className="pwrap"
                                onClick={() => openLb(it.photos, p.id)}>
                                <img src={p.url} alt="" loading="lazy" />
                                {(mine(p) || canModerate) &&
                                  <button className="pdel" aria-label="Photo options"
                                    onClick={e => { e.stopPropagation(); setPhotoMenu(Number(p.id)); }}>&times;</button>}
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
                      {selecting && selected.includes(Number(it.id)) &&
                        <span className="pcheck">&#10003;</span>}
                      {!selecting && (mine(it) || canModerate) &&
                        <button className="pdel" aria-label="Delete photo"
                          onClick={e => { e.stopPropagation(); deletePhoto(it.id); }}>&times;</button>}
                    </span>
                  )}
                  <div className="meta">
                    {it.author} &middot; {new Date(it.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {it.place_name ? <> &middot; {it.place_name}</> : null}
                    {it.type === "entry" && editing !== it.id && (mine(it) || canModerate) && (
                      <span className="act-links">
                        <a role="button" tabIndex={0}
                          onClick={() => { setEditing(it.id); setEditText(it.text || ""); }}>Edit</a>
                        <a role="button" tabIndex={0}
                          onClick={() => deleteEntry(it.id)}>Delete</a>
                      </span>
                    )}
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
        {!viewer && <div className="card" style={{ marginTop: 16 }}>
          <label htmlFor="note">Add a note{attached.length ? ` (${attached.length} photo${attached.length > 1 ? "s" : ""} attached)` : ""}</label>
          <textarea id="note" rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder="What happened? Tip: the mic on your keyboard works great here." />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={saveNote} disabled={!note.trim() && !attached.length}>Save note</button>
          </div>
        </div>}
      </main>

      {selecting && (
        <div className="grp-bar">
          {selected.length === 0
            ? <span>Tap your loose photos to select them, then annotate.</span>
            : <button onClick={() => {
                const loose = items.filter(x => x.type === "photo");
                annotateSelection(loose);
              }}>Annotate {selected.length} photo{selected.length > 1 ? "s" : ""} with a note</button>}
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
      {lb && (
        <div className="lightbox" onClick={() => setLb(null)}>
          <div className="lb-body" onClick={e => e.stopPropagation()}>
            <img src={lb.list[lb.i].url} alt="" />
            <div className="lb-meta">
              <b>{lb.list[lb.i].author}</b>
              <span>{new Date(lb.list[lb.i].ts).toLocaleString()}</span>
              <span>{lb.list[lb.i].place_name || ""}</span>
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
      {!viewer && <div className="capture-bar">
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Adding..." : "Add photos"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          multiple hidden onChange={onFiles} />
      </div>}
    </>
  );
}
