"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function BookPage() {
  const { id } = useParams();
  const [exports_, setExports] = useState([]);
  const [draft, setDraft] = useState(undefined);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [e, d] = await Promise.all([
      fetch(`/api/trips/${id}/exports`).then(r => r.json()),
      fetch(`/api/trips/${id}/draft`).then(r => r.json())
    ]);
    setExports(e.exports || []);
    setDraft(d.draft);
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function exportPdf() {
    setErr("");
    const r = await fetch(`/api/trips/${id}/exports`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    await fetch(`/api/exports/${j.exportId}/render`, { method: "POST" });
    load();
  }

  const label = { generating: "Writing...", preview: "Snapshot taken",
    rendering: "Making the PDF...", done: "PDF ready", error: "Failed" };

  return (<>
    <div className="topbar">
      <Link href={`/trip/${id}`} style={{ color: "#cfe3ec" }}>&larr; Timeline</Link>
      <span className="brand">Book</span><span />
    </div>
    <main>
      <div className="card">
        <b>Your book</b>
        {draft === undefined ? <p className="muted">Loading...</p> : draft ? (
          <p className="muted">Draft last edited {new Date(draft.updated_at).toLocaleString()}.
            {draft.status === "generating" ? " Generation in progress." : ""}</p>
        ) : (
          <p className="muted">No draft yet. Open the editor to generate one.</p>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <Link className="btn" style={{ textAlign: "center", padding: "12px 18px" }}
            href={`/trip/${id}/book/edit`}>Open editor</Link>
          {draft && draft.status !== "generating" && draft.spec?.chapters?.length > 0 &&
            <button className="secondary" onClick={exportPdf}>Export PDF</button>}
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      {exports_.map(ex => (
        <div key={ex.id} className="card">
          <b>Export &middot; {label[ex.status]}</b>
          <p className="muted" style={{ margin: "4px 0" }}>
            {new Date(ex.created_at).toLocaleString()}</p>
          {ex.error && <p className="error">{ex.error}</p>}
          <div className="row">
            {["preview", "error"].includes(ex.status) && (
              <button className="small secondary"
                onClick={async () => { await fetch(`/api/exports/${ex.id}/render`, { method: "POST" }); load(); }}>
                {ex.status === "error" ? "Retry PDF" : "Make PDF"}</button>)}
            {ex.status === "done" && (
              <a className="btn small" style={{ textAlign: "center", padding: "8px 14px" }}
                href={`/api/exports/${ex.id}/download`}>Download PDF</a>)}
          </div>
        </div>
      ))}
    </main>
  </>);
}
