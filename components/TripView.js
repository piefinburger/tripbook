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
  const [listening, setListening] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const fileRef = useRef(null);
  const recRef = useRef(null);

  const loadTimeline = useCallback(async () => {
    const r = await fetch(`/api/trips/${tripId}/timeline${person ? `?person=${person}` : ""}`);
    if (r.ok) setItems((await r.json()).items);
  }, [tripId, person]);

  useEffect(() => {
    fetch(`/api/trips/${tripId}`).then(r => r.json()).then(d => {
      setTrip(d.trip); setMembers(d.members || []);
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

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
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
    setBusy(false);
    loadTimeline();
  }

  async function saveNote() {
    const payload = {
      tripId: Number(tripId), clientId: crypto.randomUUID(),
      ts: new Date().toISOString(), text: note, photoIds: attached,
      ...(await getPosition())
    };
    setNote(""); setAttached([]);
    if (navigator.onLine) {
      const r = await fetch("/api/entries", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { loadTimeline(); return; }
    }
    await queueItem({ kind: "entry", payload });
    setPending(await outboxCount());
  }

  // Web Speech API: shown only when available; iOS keyboard dictation is the
  // reliable fallback and works in the textarea regardless.
  const speechAvailable = typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  function toggleSpeech() {
    if (listening) { recRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      const chunk = [...e.results].slice(e.resultIndex).map(r => r[0].transcript).join(" ");
      setNote(n => (n ? n + " " : "") + chunk.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function sendInvite() {
    setInviteMsg("");
    const r = await fetch(`/api/trips/${tripId}/invite`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }) });
    setInviteMsg(r.ok ? `Invite sent to ${inviteEmail}.` : (await r.json()).error);
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
      <div className="topbar">
        <Link href="/" style={{ color: "#cfe3ec" }}>&larr; Trips</Link>
        <span className="brand">{trip?.name || ""}</span>
        <span className="row" style={{ gap: 12 }}>
          <Link href={`/trip/${tripId}/gallery`} style={{ color: "#cfe3ec" }}>Gallery</Link>
          <Link href={`/trip/${tripId}/book`} style={{ color: "#f2b441", fontWeight: 700 }}>Book</Link>
        </span>
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
          <button className="small secondary" onClick={() => setShowInvite(s => !s)}>Invite</button>
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
                    <>
                      {it.text && <div>{it.text}</div>}
                      {it.photos?.length > 0 && (
                        <div className="photo-grid">
                          {it.photos.map(p => <img key={p.id} src={p.url} alt="" loading="lazy" />)}
                        </div>
                      )}
                    </>
                  ) : (
                    <img src={it.url} alt="" loading="lazy" />
                  )}
                  <div className="meta">
                    {it.author} &middot; {new Date(it.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {it.place_name ? <> &middot; {it.place_name}</> : null}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))}

        <div className="card" style={{ marginTop: 16 }}>
          <label htmlFor="note">Add a note{attached.length ? ` (${attached.length} photo${attached.length > 1 ? "s" : ""} attached)` : ""}</label>
          <textarea id="note" rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder="What happened? Tip: the mic on your keyboard works great here." />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={saveNote} disabled={!note.trim() && !attached.length}>Save note</button>
            {speechAvailable && (
              <button className={listening ? "" : "secondary"} onClick={toggleSpeech}
                aria-pressed={listening}>
                {listening ? "Stop dictating" : "Dictate"}
              </button>
            )}
          </div>
        </div>
      </main>

      <div className="capture-bar">
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Adding..." : "Add photos"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          multiple hidden onChange={onFiles} />
      </div>
    </>
  );
}
