"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function TripList() {
  const [trips, setTrips] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    const r = await fetch("/api/trips");
    if (r.ok) setTrips((await r.json()).trips);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const r = await fetch("/api/trips", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, startDate: start || null, endDate: end || null })
    });
    if (r.ok) { setCreating(false); setName(""); load(); }
  }

  if (trips === null) return <p className="muted">Loading trips...</p>;

  return (
    <>
      {trips.length === 0 && !creating && (
        <div className="card">
          <b>No trips yet</b>
          <p className="muted">Create your first trip, then invite the family
          with a link or QR code.</p>
        </div>
      )}
      {trips.map(t => (
        <Link key={t.id} href={`/trip/${t.id}`}>
          <div className="card">
            {t.cover_url && <img src={t.cover_url} alt="" style={{
              width: "100%", borderRadius: 8, aspectRatio: "2/1", objectFit: "cover" }} />}
            <h2 style={{ margin: "8px 0 2px" }}>{t.name}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {t.start_date ? new Date(t.start_date).toLocaleDateString() : ""}
              {t.end_date ? ` to ${new Date(t.end_date).toLocaleDateString()}` : ""}
              {" "}&middot; {t.photo_count} photos &middot; {t.role}
            </p>
          </div>
        </Link>
      ))}
      {creating ? (
        <div className="card">
          <label htmlFor="tname">Trip name</label>
          <input id="tname" value={name} onChange={e => setName(e.target.value)}
            placeholder="Outer Banks 2026" autoFocus />
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="tstart">Starts</label>
              <input id="tstart" type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="tend">Ends</label>
              <input id="tend" type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={create} disabled={!name.trim()}>Create trip</button>
            <button className="secondary" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)}>New trip</button>
      )}
    </>
  );
}
