"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TripSettings({ tripId }) {
  const router = useRouter();
  const [trip, setTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [siteAdmin, setSiteAdmin] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteMsg, setInviteMsg] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/trips/${tripId}`).then(r => r.json());
    setTrip(d.trip); setMembers(d.members || []);
    setPending(d.pendingInvites || []);
    setMe(d.me); setSiteAdmin(!!d.siteAdmin);
    setName(d.trip?.name || "");
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  if (!trip) return <main><p className="muted">Loading...</p></main>;
  const iOwn = trip.my_role === "owner" || siteAdmin;

  async function rename() {
    setMsg("");
    const r = await fetch(`/api/trips/${tripId}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }) });
    setMsg(r.ok ? "Saved." : (await r.json()).error);
  }
  async function setRole(uid, role) {
    const r = await fetch(`/api/trips/${tripId}/members/${uid}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    load();
  }
  async function sendInvite() {
    setInviteMsg("");
    const r = await fetch(`/api/trips/${tripId}/invite`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
    const j = await r.json().catch(() => ({ error: `Invite failed (HTTP ${r.status}).` }));
    setInviteMsg(r.ok
      ? `${inviteRole === "viewer" ? "Viewer" : "Contributor"} invite sent to ${inviteEmail}.`
      : j.error);
    if (r.ok) { setInviteEmail(""); load(); }
  }

  async function deleteTrip() {
    if (!confirm(`Delete "${trip.name}" for EVERYONE? All photos, videos, notes, and the book are permanently removed.`)) return;
    if (prompt(`This cannot be undone. Type the trip name to confirm:`) !== trip.name) {
      alert("Name did not match; nothing was deleted."); return;
    }
    const r = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error); return; }
    router.push("/");
  }

  const ago = (ts) => {
    if (!ts) return "never";
    const m = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (m < 60) return "just now";
    if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
    const d = Math.floor(m / 1440);
    return d === 1 ? "yesterday" : `${d} days ago`;
  };

  const roleHelp = {
    owner: "Full control, can delete the trip",
    admin: "Can edit and delete anyone's photos and notes in this trip",
    member: "Adds photos and notes; edits only their own",
    viewer: "Watches the trip live; cannot add or change anything, no book access"
  };

  return (<>
    <div className="topbar">
      <Link href={`/trip/${tripId}`} style={{ color: "#cfe3ec" }}>&larr; Timeline</Link>
      <span className="brand">Trip settings</span><span />
    </div>
    <main>
      <div className="card">
        <b>Trip name</b>
        <div className="row" style={{ marginTop: 6 }}>
          <input value={name} onChange={e => setName(e.target.value)} disabled={!iOwn} />
          {iOwn && <button className="small" onClick={rename}>Save</button>}
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <b>Invite family</b>
        <p className="muted" style={{ margin: "4px 0" }}>Anyone with this link
          joins as a contributor:</p>
        <input readOnly value={typeof location !== "undefined" && trip.invite_code
          ? `${location.origin}/join/${trip.invite_code}` : ""}
          onFocus={e => e.target.select()} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="small" onClick={() => {
            const url = `${location.origin}/join/${trip.invite_code}`;
            navigator.share?.({ url }) ?? navigator.clipboard.writeText(url);
          }}>Share link</button>
        </div>
        <label htmlFor="invemail">Or email an invite (required for viewers)</label>
        <input id="invemail" type="email" value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)} placeholder="grandma@example.com" />
        <div className="row" style={{ marginTop: 6 }}>
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
            aria-label="Invite role" style={{ width: "auto" }}>
            <option value="member">Contributor: adds photos and notes</option>
            <option value="viewer">Viewer: watches live, adds nothing</option>
          </select>
          <button className="small" onClick={sendInvite} disabled={!inviteEmail}>Send</button>
        </div>
        {inviteMsg && <p className="muted">{inviteMsg}</p>}
        {pending.length > 0 && (<>
          <label>Invited, not yet joined</label>
          {pending.map((iv, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between",
              padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: "0.85rem" }}>{iv.email}</span>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {iv.invite_role} &middot; expires {new Date(iv.expires_at).toLocaleDateString()}</span>
            </div>))}
        </>)}
      </div>

      <div className="card">
        <b>Members</b>
        <p className="muted" style={{ margin: "4px 0 8px" }}>Admins can edit
          and delete anyone&apos;s photos and notes in this trip.</p>
        {members.map(m => (
          <div key={m.id} className="row"
            style={{ justifyContent: "space-between", padding: "8px 0",
              borderBottom: "1px solid var(--line)" }}>
            <div>
              <b style={{ fontSize: "0.9rem" }}>{m.name || m.email}</b>
              {Number(m.id) === Number(me) && <span className="pill" style={{ marginLeft: 6 }}>you</span>}
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                {roleHelp[m.role]} &middot; active {ago(m.last_active_at)}</div>
            </div>
            {m.role === "owner" ? <span className="pill">owner</span> : iOwn ? (
              <select value={m.role} aria-label={`Role for ${m.name || m.email}`}
                style={{ width: "auto" }}
                onChange={e => setRole(m.id, e.target.value)}>
                <option value="viewer">viewer</option>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            ) : <span className="pill">{m.role}</span>}
          </div>
        ))}
      </div>

      {iOwn && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <b style={{ color: "var(--danger)" }}>Danger zone</b>
          <p className="muted" style={{ margin: "4px 0 8px" }}>Deletes the trip,
            every photo and video from storage, all notes, and the book. There
            is no undo.</p>
          <button className="small" style={{ background: "var(--danger)" }}
            onClick={deleteTrip}>Delete this trip</button>
        </div>
      )}
    </main>
  </>);
}
