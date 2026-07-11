"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const TPL_COUNT = { "full-bleed": 1, "two-up": 2, "three-grid": 3, "photo-text": 1, "text-only": 0 };
const TPL_BY_COUNT = { 0: "text-only", 1: "full-bleed", 2: "two-up", 3: "three-grid" };
const uid = () => "pg_" + Math.random().toString(16).slice(2, 10);

export default function BookEditor({ tripId }) {
  const [draft, setDraft] = useState(undefined); // undefined loading, null none
  const [revisions, setRevisions] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [tab, setTab] = useState(null); // photos | assistant | history | null (mobile sheet)
  const [deskTab, setDeskTab] = useState("photos");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState("auto");
  const saveTimer = useRef(null);
  const needRevision = useRef(true);
  const specRef = useRef(null);

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([
      fetch(`/api/trips/${tripId}/draft`).then(r => r.json()),
      fetch(`/api/trips/${tripId}/photos`).then(r => r.json())
    ]);
    setDraft(d.draft); setRevisions(d.revisions || []);
    specRef.current = d.draft?.spec || null;
    setPhotos(p.photos || []);
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  // poll while generating
  useEffect(() => {
    if (draft?.status !== "generating") return;
    const t = setInterval(async () => {
      const d = await fetch(`/api/trips/${tripId}/draft`).then(r => r.json());
      if (d.draft?.status !== "generating") {
        setDraft(d.draft); setRevisions(d.revisions || []);
        specRef.current = d.draft?.spec || null;
      }
    }, 4000);
    return () => clearInterval(t);
  }, [draft?.status, tripId]);

  const spec = draft?.spec;
  const usedMap = useMemo(() => {
    const m = new Map();
    for (const ch of spec?.chapters || [])
      for (const pg of ch.pages) for (const id of pg.photoIds) m.set(Number(id), pg.id);
    return m;
  }, [spec]);
  const excluded = useMemo(
    () => new Set((spec?.excludedPhotoIds || []).map(Number)), [spec]);
  const photoById = useMemo(
    () => Object.fromEntries(photos.map(p => [Number(p.id), p])), [photos]);

  // ---- spec mutation + autosave --------------------------------------------
  function mutate(fn) {
    setDraft(d => {
      const next = JSON.parse(JSON.stringify(d));
      fn(next.spec);
      specRef.current = next.spec;
      return next;
    });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 1500);
  }
  async function save() {
    const body = { spec: specRef.current, cutRevision: needRevision.current };
    needRevision.current = false;
    const r = await fetch(`/api/trips/${tripId}/draft`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) setNotice({ kind: "error",
      text: (await r.json()).error || "Save failed. Your last change was not stored." });
  }
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ---- page helpers ---------------------------------------------------------
  const forPage = (pageId, fn) => mutate(s => {
    for (const ch of s.chapters) {
      const pg = ch.pages.find(p => p.id === pageId);
      if (pg) { fn(pg, ch, s); return; }
    }
  });
  function placePhoto(photoId) {
    if (!selectedPage) { setNotice({ kind: "info", text: "Tap a page first, then a photo to place it." }); return; }
    forPage(selectedPage, (pg) => {
      if (pg.pinned) return;
      if (pg.photoIds.map(Number).includes(photoId)) return;
      if (pg.template === "photo-text") { pg.photoIds = [photoId]; return; }
      if (pg.photoIds.length >= 3) { setNotice({ kind: "info", text: "That page is full (3 photos max). Insert a new page." }); return; }
      pg.photoIds = [...pg.photoIds.map(Number), photoId];
      pg.template = TPL_BY_COUNT[pg.photoIds.length];
    });
  }
  function removePhoto(pageId, photoId) {
    forPage(pageId, pg => {
      pg.photoIds = pg.photoIds.map(Number).filter(x => x !== Number(photoId));
      if (pg.template !== "photo-text" || pg.photoIds.length === 0)
        pg.template = TPL_BY_COUNT[pg.photoIds.length];
    });
  }
  function toggleExclude(photoId) {
    mutate(s => {
      const ex = new Set((s.excludedPhotoIds || []).map(Number));
      if (ex.has(photoId)) ex.delete(photoId);
      else {
        ex.add(photoId);
        for (const ch of s.chapters) for (const pg of ch.pages) {
          if (pg.pinned) continue;
          if (pg.photoIds.map(Number).includes(photoId)) {
            pg.photoIds = pg.photoIds.map(Number).filter(x => x !== photoId);
            if (pg.template !== "photo-text" || pg.photoIds.length === 0)
              pg.template = TPL_BY_COUNT[pg.photoIds.length];
          }
        }
        for (const ch of s.chapters)
          ch.pages = ch.pages.filter(pg => pg.pinned || pg.photoIds.length || (pg.text || "").trim());
      }
      s.excludedPhotoIds = [...ex];
    });
  }
  function movePage(pageId, dir) {
    mutate(s => {
      for (let ci = 0; ci < s.chapters.length; ci++) {
        const ch = s.chapters[ci];
        const i = ch.pages.findIndex(p => p.id === pageId);
        if (i < 0) continue;
        const [pg] = ch.pages.splice(i, 1);
        let ti = i + dir, tc = ci;
        if (ti < 0 && ci > 0) { tc = ci - 1; ti = s.chapters[tc].pages.length; }
        else if (ti > ch.pages.length && ci < s.chapters.length - 1) { tc = ci + 1; ti = 0; }
        ti = Math.max(0, Math.min(ti, s.chapters[tc].pages.length));
        s.chapters[tc].pages.splice(ti, 0, pg);
        return;
      }
    });
  }
  function insertPage(chapterId, afterPageId) {
    const id = uid();
    mutate(s => {
      const ch = s.chapters.find(c => c.id === chapterId);
      const at = afterPageId ? ch.pages.findIndex(p => p.id === afterPageId) + 1 : ch.pages.length;
      ch.pages.splice(at, 0, { id, template: "text-only", photoIds: [],
        caption: "", text: "New page. Add photos from the tray or write here.", pinned: false });
    });
    setSelectedPage(id);
  }

  // ---- AI ------------------------------------------------------------------
  async function runAi(instr, scope) {
    setBusy("ai");
    setNotice(null);
    const r = await fetch(`/api/trips/${tripId}/draft/ai-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: instr, scope })
    });
    const j = await r.json();
    setBusy("");
    if (!r.ok) { setNotice({ kind: "error", text: j.error }); return; }
    needRevision.current = true;
    setNotice({ kind: "ok", text:
      `${j.summary} (${j.applied} change${j.applied === 1 ? "" : "s"}` +
      `${j.rejected?.length ? `, ${j.rejected.length} rejected: ${j.rejected[0].why}` : ""}` +
      `${j.fallback ? ", fallback model used" : ""})` });
    load();
  }
  async function generate() {
    setBusy("gen");
    await fetch(`/api/trips/${tripId}/draft/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }) });
    setBusy("");
    setDraft(d => d ? { ...d, status: "generating" } : { status: "generating", spec: null });
  }
  async function restore(rid) {
    await fetch(`/api/trips/${tripId}/draft/revisions/${rid}/restore`, { method: "POST" });
    needRevision.current = true;
    load();
  }

  // ---- render ---------------------------------------------------------------
  if (draft === undefined) return <main><p className="muted">Loading editor...</p></main>;

  const topbar = (
    <div className="topbar">
      <Link href={`/trip/${tripId}/book`} style={{ color: "#cfe3ec" }}>&larr; Book</Link>
      <span className="brand">Editor</span>
      <span className="row" style={{ gap: 14 }}>
        {revisions.length > 0 &&
          <a role="button" tabIndex={0} style={{ color: "#cfe3ec", cursor: "pointer" }}
            onClick={() => restore(revisions[0].id)}>Undo</a>}
        <Link href={`/book/preview/draft/${tripId}`} style={{ color: "#f2b441", fontWeight: 700 }}>
          Preview</Link>
      </span>
    </div>
  );

  if (!draft || draft.status === "generating" || !spec?.chapters?.length) {
    return (<>{topbar}<main>
      <div className="card">
        {draft?.status === "generating" ? (
          <><b>Writing the book...</b>
          <p className="muted">Usually under two minutes. This page updates itself.</p></>
        ) : (<>
          <b>No draft yet</b>
          <p className="muted">Generate a first draft, then edit every page here.</p>
          {draft?.status === "error" && <p className="error">{draft.error}</p>}
          <label htmlFor="mode">How should it be written?</label>
          <select id="mode" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="auto">Auto-narrative: AI writes connecting text and captions</option>
            <option value="curated">Curated: only the family&apos;s own words</option>
          </select>
          <div style={{ marginTop: 12 }}>
            <button onClick={generate} disabled={busy === "gen"}>Generate draft</button>
          </div>
        </>)}
      </div>
    </main></>);
  }

  const panels = {
    photos: <TrayPanel photos={photos} usedMap={usedMap} excluded={excluded}
      onPlace={placePhoto} onToggleExclude={toggleExclude}
      onCurate={() => runAi(
        "Review unused and in-book photos; swap in stronger ones, drop weak or duplicate ones, keep the page count similar.",
        {})} busy={busy} />,
    assistant: <AssistantPanel instruction={instruction} setInstruction={setInstruction}
      busy={busy} onRun={() => { runAi(instruction, {}); setInstruction(""); }} notice={notice} />,
    history: <HistoryPanel revisions={revisions} onRestore={restore} />
  };

  return (<>
    {topbar}
    {notice && <div className="sync-chip" role="status"
      style={notice.kind === "error" ? { background: "#f3c8bd" } : {}}
      onClick={() => setNotice(null)}>{notice.text}</div>}
    <main className="wide">
      <div className="ed-layout">
        <div>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <div style={{ flex: 1 }}>
              <label>Title</label>
              <input value={spec.title}
                onChange={e => mutate(s => { s.title = e.target.value; })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Subtitle</label>
              <input value={spec.subtitle}
                onChange={e => mutate(s => { s.subtitle = e.target.value; })} />
            </div>
          </div>

          {spec.chapters.map(ch => (
            <section key={ch.id}>
              <div className="chapter-head">
                <div className="day-tag">Chapter</div>
                <input value={ch.title} placeholder="Chapter title"
                  onChange={e => mutate(s => {
                    s.chapters.find(c => c.id === ch.id).title = e.target.value; })} />
                <textarea rows={2} value={ch.narrative} placeholder="Chapter narrative (optional)"
                  onChange={e => mutate(s => {
                    s.chapters.find(c => c.id === ch.id).narrative = e.target.value; })} />
              </div>
              {ch.pages.map(pg => (
                <PageCard key={pg.id} pg={pg} photoById={photoById}
                  selected={selectedPage === pg.id}
                  onSelect={() => setSelectedPage(pg.id)}
                  onTemplate={t => forPage(pg.id, p => {
                    if (TPL_COUNT[t] < p.photoIds.length) p.photoIds = p.photoIds.slice(0, TPL_COUNT[t]);
                    p.template = t; })}
                  onCaption={v => forPage(pg.id, p => { p.caption = v; })}
                  onText={v => forPage(pg.id, p => { p.text = v; })}
                  onRemovePhoto={id => removePhoto(pg.id, id)}
                  onMove={d => movePage(pg.id, d)}
                  onDelete={() => mutate(s => {
                    const c = s.chapters.find(c2 => c2.pages.some(p => p.id === pg.id));
                    c.pages = c.pages.filter(p => p.id !== pg.id); })}
                  onPin={() => forPage(pg.id, p => { p.pinned = !p.pinned; })}
                  onAi={instr => runAi(instr, { pageId: pg.id })}
                  busy={busy} />
              ))}
              <div className="insert-page">
                <button onClick={() => insertPage(ch.id, ch.pages[ch.pages.length - 1]?.id)}>
                  + Insert page</button>
              </div>
            </section>
          ))}
        </div>

        <aside className="ed-side">
          <div className="ed-tabs">
            {["photos", "assistant", "history"].map(t => (
              <button key={t} className={deskTab === t ? "active" : ""}
                onClick={() => setDeskTab(t)}>
                {t === "photos" ? `Photos (${photos.length})` : t[0].toUpperCase() + t.slice(1)}
              </button>))}
          </div>
          <div className="ed-panel">{panels[deskTab]}</div>
        </aside>
      </div>
    </main>

    {tab && <div className="ed-sheet">
      <div className="ed-tabs">
        {["photos", "assistant", "history"].map(t => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}</button>))}
        <button style={{ marginLeft: "auto" }} onClick={() => setTab(null)}>Close</button>
      </div>
      <div className="ed-panel">{panels[tab]}</div>
    </div>}
    <div className="ed-toolbar">
      <button className={tab === "photos" ? "active" : ""}
        onClick={() => setTab(tab === "photos" ? null : "photos")}>Photos</button>
      <button className={tab === "assistant" ? "active" : ""}
        onClick={() => setTab(tab === "assistant" ? null : "assistant")}>Assistant</button>
      <button className={tab === "history" ? "active" : ""}
        onClick={() => setTab(tab === "history" ? null : "history")}>History</button>
    </div>
  </>);
}

function PageCard({ pg, photoById, selected, onSelect, onTemplate, onCaption, onText,
  onRemovePhoto, onMove, onDelete, onPin, onAi, busy }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [instr, setInstr] = useState("");
  const imgs = pg.photoIds.map(Number).map(id => photoById[id]).filter(Boolean);
  return (
    <div className={`page-card ${selected ? "selected" : ""} ${pg.pinned ? "pinned" : ""}`}
      onClick={onSelect}>
      <div className={`page-canvas tpl-${pg.template}`}>
        {imgs.map(p => <img key={p.id} src={p.url} alt="" />)}
        {(pg.template === "photo-text" || pg.template === "text-only") &&
          <div className="txt-block">{pg.text}</div>}
      </div>
      {pg.template !== "text-only" && (
        <>
          <label>Caption</label>
          <input value={pg.caption} disabled={pg.pinned}
            onChange={e => onCaption(e.target.value)} placeholder="Caption (optional)" />
        </>)}
      {(pg.template === "photo-text" || pg.template === "text-only") && (
        <>
          <label>Text</label>
          <textarea rows={3} value={pg.text} disabled={pg.pinned}
            onChange={e => onText(e.target.value)} />
        </>)}
      <div className="page-actions" onClick={e => e.stopPropagation()}>
        <select value={pg.template} disabled={pg.pinned} aria-label="Page template"
          style={{ width: "auto", padding: "6px 8px", fontSize: "0.78rem" }}
          onChange={e => onTemplate(e.target.value)}>
          {Object.keys(TPL_COUNT).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {imgs.map(p => (
          <button key={p.id} disabled={pg.pinned} onClick={() => onRemovePhoto(p.id)}
            title="Remove this photo">x photo</button>))}
        <button onClick={() => onMove(-1)}>Move up</button>
        <button onClick={() => onMove(1)}>Move down</button>
        <button onClick={onPin}>{pg.pinned ? "Unpin" : "Pin"}</button>
        <button className="warn" disabled={pg.pinned} onClick={onDelete}>Delete</button>
        <button onClick={() => setAiOpen(o => !o)}>AI: redo</button>
      </div>
      {aiOpen && (
        <div className="row" style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <input value={instr} placeholder="e.g. funnier caption, swap for a better photo"
            onChange={e => setInstr(e.target.value)} />
          <button className="small" disabled={busy === "ai"}
            onClick={() => { onAi(instr || "Improve this page."); setInstr(""); setAiOpen(false); }}>
            {busy === "ai" ? "..." : "Go"}</button>
        </div>)}
    </div>
  );
}

function TrayPanel({ photos, usedMap, excluded, onPlace, onToggleExclude, onCurate, busy }) {
  const [sort, setSort] = useState("time");
  const sorted = [...photos].sort((a, b) => sort === "quality"
    ? (b.quality ?? -1) - (a.quality ?? -1) : new Date(a.ts) - new Date(b.ts));
  const inBook = photos.filter(p => usedMap.has(Number(p.id))).length;
  return (<>
    <p className="muted" style={{ margin: "0 0 8px" }}>
      {photos.length} photos, {inBook} in book, {excluded.size} excluded.
      Tap a page in the book, then tap a photo to place it. Long-press
      (right-click on laptop) to exclude.</p>
    <div className="row" style={{ marginBottom: 8 }}>
      <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort photos">
        <option value="time">By time</option>
        <option value="quality">By quality score</option>
      </select>
      <button className="small secondary" onClick={onCurate} disabled={busy === "ai"}>
        {busy === "ai" ? "Working..." : "AI curate"}</button>
    </div>
    <div className="tray-grid">
      {sorted.map(p => {
        const id = Number(p.id);
        const state = excluded.has(id) ? "ex" : usedMap.has(id) ? "in" : null;
        return (
          <div key={id} className={`tray-item ${state === "ex" ? "excluded" : ""}`}
            onClick={() => state !== "ex" && onPlace(id)}
            onContextMenu={e => { e.preventDefault(); onToggleExclude(id); }}>
            <img src={p.url} alt="" loading="lazy" />
            {state && <span className={`tray-badge ${state}`}>
              {state === "in" ? "In book" : "Excluded"}</span>}
            {p.quality != null && <span className="tray-q">{p.quality}</span>}
          </div>);
      })}
    </div>
  </>);
}

function AssistantPanel({ instruction, setInstruction, busy, onRun, notice }) {
  return (<>
    <p className="muted" style={{ marginTop: 0 }}>Ask for book-wide changes.
      Examples: &quot;tighten day 2 into one chapter&quot;, &quot;plainer tone&quot;,
      &quot;give the beach photos their own chapter&quot;.</p>
    <textarea rows={3} value={instruction} onChange={e => setInstruction(e.target.value)}
      placeholder="What should change?" />
    <div style={{ marginTop: 8 }}>
      <button onClick={onRun} disabled={busy === "ai" || !instruction.trim()}>
        {busy === "ai" ? "Working..." : "Apply with AI"}</button>
    </div>
    {notice && <p className={notice.kind === "error" ? "error" : "muted"}
      style={{ marginTop: 8 }}>{notice.text}</p>}
  </>);
}

function HistoryPanel({ revisions, onRestore }) {
  if (!revisions.length) return <p className="muted">No history yet.</p>;
  return revisions.map(r => (
    <div key={r.id} className="row"
      style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <div>
        <b style={{ fontSize: "0.85rem" }}>{r.source}</b>
        <div className="muted" style={{ fontSize: "0.75rem" }}>
          {r.note || ""} {new Date(r.created_at).toLocaleString()}</div>
      </div>
      <button className="small secondary" onClick={() => onRestore(r.id)}>Restore</button>
    </div>
  ));
}
