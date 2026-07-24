"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageCanvas from "./PageCanvas";
import TemplatePicker from "./TemplatePicker";

const TPL_COUNT = {
  "full-bleed": 1, "hero-left": 2, "hero-right": 2, "hero-top": 2, "two-equal": 2,
  "three-banner": 3, "three-sidebar": 3, "panoramic-strip": 3,
  "four-grid": 4, "four-asymmetric": 4, "five-mosaic": 5, "six-grid": 6,
  "photo-text": 1, "text-photo": 1, "text-only": 0,
  "two-up": 2, "three-grid": 3, // legacy aliases
};
const TPL_BY_COUNT = { 0: "text-only", 1: "full-bleed", 2: "two-equal", 3: "three-banner", 4: "four-grid", 5: "five-mosaic", 6: "six-grid" };
const uid = () => "pg_" + Math.random().toString(16).slice(2, 10);

export default function BookEditor({ tripId }) {
  const [draft, setDraft] = useState(undefined); // undefined loading, null none
  const [drafts, setDrafts] = useState([]); // all books for this trip
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [tab, setTab] = useState(null); // photos | assistant | history | null (mobile sheet)
  const [deskTab, setDeskTab] = useState("photos");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState("auto");
  const [draggingPhotoId, setDraggingPhotoId] = useState(null);
  const [awaitingSlot, setAwaitingSlot] = useState(null); // { pageId, slotIndex }
  const saveTimer = useRef(null);
  const needRevision = useRef(true);
  const specRef = useRef(null);

  const load = useCallback(async (draftId) => {
    const url = draftId
      ? `/api/trips/${tripId}/draft?draftId=${draftId}`
      : `/api/trips/${tripId}/draft`;
    const [d, p] = await Promise.all([
      fetch(url).then(r => r.json()),
      fetch(`/api/trips/${tripId}/photos`).then(r => r.json())
    ]);
    setDraft(d.draft); setRevisions(d.revisions || []);
    setDrafts(d.drafts || []);
    if (d.draft?.id) setActiveDraftId(Number(d.draft.id));
    specRef.current = d.draft?.spec || null;
    setPhotos(p.photos || []);
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  // poll while generating
  useEffect(() => {
    if (draft?.status !== "generating") return;
    const t = setInterval(async () => {
      const url = activeDraftId
        ? `/api/trips/${tripId}/draft?draftId=${activeDraftId}`
        : `/api/trips/${tripId}/draft`;
      const d = await fetch(url).then(r => r.json());
      if (d.draft?.status !== "generating") {
        setDraft(d.draft); setRevisions(d.revisions || []);
        setDrafts(d.drafts || []);
        specRef.current = d.draft?.spec || null;
      }
    }, 4000);
    return () => clearInterval(t);
  }, [draft?.status, tripId, activeDraftId]);

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
    const body = { spec: specRef.current, cutRevision: needRevision.current, draftId: activeDraftId };
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

  // Place a photo into a specific slot on a page.
  function placePhotoInSlot(pageId, slotIndex, photoId) {
    setAwaitingSlot(null);
    forPage(pageId, (pg) => {
      if (pg.pinned) return;
      const ids = [...(pg.photoIds || []).map(Number)];
      const maxSlots = TPL_COUNT[pg.template] ?? 0;
      if (slotIndex >= maxSlots) return;
      // Remove the photo from wherever it already is (same page, different slot)
      const existingIdx = ids.indexOf(Number(photoId));
      if (existingIdx !== -1) ids.splice(existingIdx, 1, null);
      // Place at target slot, padding with nulls if needed
      while (ids.length <= slotIndex) ids.push(null);
      ids[slotIndex] = Number(photoId);
      pg.photoIds = ids.filter(x => x !== null);
    });
  }

  // Place a photo into the first empty slot (or append). Used for sidebar tap-to-place.
  function placePhotoInPage(pageId, photoId) {
    forPage(pageId, (pg) => {
      if (pg.pinned) return;
      const ids = (pg.photoIds || []).map(Number);
      const maxSlots = TPL_COUNT[pg.template] ?? 0;
      if (ids.includes(Number(photoId))) return;
      if (ids.length >= maxSlots) {
        setNotice({ kind: "info", text: "Page is full. Remove a photo or choose a template with more slots." });
        return;
      }
      pg.photoIds = [...ids, Number(photoId)];
    });
  }

  function removePhotoAtSlot(pageId, slotIndex) {
    forPage(pageId, pg => {
      const ids = (pg.photoIds || []).map(Number);
      ids.splice(slotIndex, 1);
      pg.photoIds = ids;
    });
  }

  // Legacy: remove by photoId (still used by exclude toggle)
  function removePhoto(pageId, photoId) {
    forPage(pageId, pg => {
      pg.photoIds = pg.photoIds.map(Number).filter(x => x !== Number(photoId));
    });
  }

  function handleSlotClick(pageId, slotIndex) {
    // If there's an awaiting slot on this page+slot, clear it; else set it
    if (awaitingSlot?.pageId === pageId && awaitingSlot?.slotIndex === slotIndex) {
      setAwaitingSlot(null);
    } else {
      setAwaitingSlot({ pageId, slotIndex });
      setSelectedPage(pageId);
    }
  }

  function handleSidebarPhotoClick(photoId) {
    if (awaitingSlot) {
      placePhotoInSlot(awaitingSlot.pageId, awaitingSlot.slotIndex, photoId);
    } else if (selectedPage) {
      placePhotoInPage(selectedPage, photoId);
    } else {
      setNotice({ kind: "info", text: "Click a page first, then a photo to place it." });
    }
  }
  function toggleExclude(photoId) {
    mutate(s => {
      const ex = new Set((s.excludedPhotoIds || []).map(Number));
      if (ex.has(photoId)) ex.delete(photoId);
      else {
        ex.add(photoId);
        for (const ch of s.chapters) for (const pg of ch.pages) {
          if (pg.pinned) continue;
          pg.photoIds = pg.photoIds.map(Number).filter(x => x !== Number(photoId));
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
      body: JSON.stringify({ instruction: instr, scope, draftId: activeDraftId })
    });
    const j = await r.json();
    setBusy("");
    if (!r.ok) { setNotice({ kind: "error", text: j.error }); return; }
    needRevision.current = true;
    setNotice({ kind: "ok", text:
      `${j.summary} (${j.applied} change${j.applied === 1 ? "" : "s"}` +
      `${j.rejected?.length ? `, ${j.rejected.length} rejected: ${j.rejected[0].why}` : ""}` +
      `${j.fallback ? ", fallback model used" : ""})` });
    load(activeDraftId);
  }
  async function generate() {
    setBusy("gen");
    const r = await fetch(`/api/trips/${tripId}/draft/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }) });
    const j = await r.json();
    setBusy("");
    if (j.draftId) {
      setActiveDraftId(j.draftId);
      setDraft({ status: "generating", spec: null });
    }
  }
  async function restore(rid) {
    await fetch(`/api/trips/${tripId}/draft/revisions/${rid}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: activeDraftId })
    });
    needRevision.current = true;
    load(activeDraftId);
  }
  async function switchDraft(id) {
    clearTimeout(saveTimer.current);
    setActiveDraftId(id);
    setSelectedPage(null);
    load(id);
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
        <Link href={`/book/preview/draft/${tripId}?draftId=${activeDraftId}`}
          style={{ color: "#f2b441", fontWeight: 700 }}>Preview</Link>
      </span>
    </div>
  );

  const draftPicker = drafts.length > 0 && (
    <div className="card" style={{ marginBottom: 8, padding: "10px 16px" }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--ink)", opacity: 0.6, whiteSpace: "nowrap" }}>
          Books:
        </span>
        {drafts.map(d => (
          <button key={d.id} className={`small ${Number(d.id) === activeDraftId ? "" : "secondary"}`}
            onClick={() => switchDraft(Number(d.id))}
            title={new Date(d.created_at).toLocaleString()}>
            {d.name || "Untitled Book"}
            {d.status === "generating" && " ⏳"}
            {d.status === "error" && " ⚠"}
          </button>
        ))}
        <button className="small secondary" onClick={() => setDraft(null)}
          title="Generate a new book from scratch">+ New Book</button>
      </div>
    </div>
  );

  if (!draft || draft.status === "generating" || !spec?.chapters?.length) {
    return (<>{topbar}<main>
      {draftPicker}
      <div className="card">
        {draft?.status === "generating" ? (
          <><b>Writing the book...</b>
          <p className="muted">Usually under two minutes. This page updates itself.</p></>
        ) : (<>
          <b>{drafts.length > 0 ? "Generate a new book" : "No draft yet"}</b>
          <p className="muted">Generate a draft, then edit every page here.</p>
          {draft?.status === "error" && <p className="error">{draft.error}</p>}
          <label htmlFor="mode">How should it be written?</label>
          <select id="mode" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="auto">Auto-narrative: AI writes connecting text and captions</option>
            <option value="curated">Curated: only the family&apos;s own words</option>
          </select>
          <div style={{ marginTop: 12 }}>
            <button onClick={generate} disabled={busy === "gen"}>
              {busy === "gen" ? "Starting..." : drafts.length > 0 ? "Generate new book" : "Generate draft"}
            </button>
          </div>
        </>)}
      </div>
    </main></>);
  }

  const panels = {
    photos: <TrayPanel photos={photos} usedMap={usedMap} excluded={excluded}
      onPlace={handleSidebarPhotoClick} onToggleExclude={toggleExclude}
      awaitingSlot={awaitingSlot}
      onDragStart={pid => setDraggingPhotoId(pid)}
      onDragEnd={() => setDraggingPhotoId(null)}
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
      {draftPicker}
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
              {ch.pages.map(pg => {
                const focused = selectedPage === pg.id;
                return (
                  <div key={pg.id} className={`pg-card ${focused ? "pg-card-focused" : ""}`}>
                    <div className="pg-card-header">
                      <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                        {pg.pinned ? "📌 " : ""}{pg.template}
                        {pg.photoIds?.length ? ` · ${pg.photoIds.length} photo${pg.photoIds.length > 1 ? "s" : ""}` : ""}
                      </span>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="small secondary" onClick={() => movePage(pg.id, -1)}>↑</button>
                        <button className="small secondary" onClick={() => movePage(pg.id, 1)}>↓</button>
                        <button className="small secondary" onClick={() => forPage(pg.id, p => { p.pinned = !p.pinned; })}>
                          {pg.pinned ? "Unpin" : "Pin"}</button>
                        <button className="small warn" disabled={pg.pinned}
                          onClick={() => mutate(s => {
                            const c = s.chapters.find(c2 => c2.pages.some(p => p.id === pg.id));
                            c.pages = c.pages.filter(p => p.id !== pg.id); })}>
                          Delete</button>
                      </div>
                    </div>

                    <PageCanvas
                      pg={pg}
                      photoById={photoById}
                      focused={focused}
                      onFocus={() => { setSelectedPage(pg.id); setAwaitingSlot(null); }}
                      onPlacePhoto={(slotIdx, photoId) => placePhotoInSlot(pg.id, slotIdx, photoId)}
                      onRemovePhoto={(slotIdx) => removePhotoAtSlot(pg.id, slotIdx)}
                      onPhotoStyle={(photoId, style) => forPage(pg.id, p => {
                        p.photoStyles = { ...(p.photoStyles || {}), [photoId]: style };
                      })}
                      onCaption={v => forPage(pg.id, p => { p.caption = v; })}
                      onText={v => forPage(pg.id, p => { p.text = v; })}
                      draggingPhotoId={draggingPhotoId}
                      awaitingSlot={awaitingSlot?.pageId === pg.id ? awaitingSlot.slotIndex : null}
                      onSlotClick={(slotIdx) => handleSlotClick(pg.id, slotIdx)}
                    />

                    {focused && (
                      <>
                        <TemplatePicker
                          current={pg.template}
                          onChange={t => forPage(pg.id, p => {
                            const newCount = TPL_COUNT[t] ?? 0;
                            if (newCount < p.photoIds.length) p.photoIds = p.photoIds.slice(0, newCount);
                            p.template = t;
                          })}
                        />
                        {(pg.template === "photo-text" || pg.template === "text-photo" || pg.template === "text-only") && (
                          <div style={{ marginTop: 8 }}>
                            <label style={{ fontSize: "0.8rem" }}>Text</label>
                            <textarea rows={4} value={pg.text || ""}
                              onChange={e => forPage(pg.id, p => { p.text = e.target.value; })} />
                          </div>
                        )}
                        {pg.template !== "photo-text" && pg.template !== "text-photo" && pg.template !== "text-only" && (
                          <div style={{ marginTop: 8 }}>
                            <label style={{ fontSize: "0.8rem" }}>Caption</label>
                            <input value={pg.caption || ""}
                              onChange={e => forPage(pg.id, p => { p.caption = e.target.value; })}
                              placeholder="Caption (optional)" />
                          </div>
                        )}
                        <div className="pg-card-actions">
                          <button className="small secondary" disabled={busy === "ai"}
                            onClick={() => runAi("Improve this page: better photo selection or caption.", { pageId: pg.id })}>
                            {busy === "ai" ? "..." : "AI: improve page"}</button>
                          <button className="small secondary" onClick={() => insertPage(ch.id, pg.id)}>
                            + Insert page after</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="insert-page">
                <button onClick={() => insertPage(ch.id, ch.pages[ch.pages.length - 1]?.id)}>
                  + Insert page at end</button>
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


function TrayPanel({ photos, usedMap, excluded, onPlace, onToggleExclude, awaitingSlot,
  onDragStart, onDragEnd, onCurate, busy }) {
  const [sort, setSort] = useState("time");
  const [draggingId, setDraggingId] = useState(null);
  const sorted = [...photos].sort((a, b) => sort === "quality"
    ? (b.quality ?? -1) - (a.quality ?? -1) : new Date(a.ts) - new Date(b.ts));
  const inBook = photos.filter(p => usedMap.has(Number(p.id))).length;
  return (<>
    <p className="muted" style={{ margin: "0 0 8px" }}>
      {photos.length} photos · {inBook} in book · {excluded.size} excluded.
      {awaitingSlot
        ? " Tap a photo to place it in the highlighted slot."
        : " Click a page slot, then tap a photo to place it. Drag onto a slot on desktop."}</p>
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
          <div key={id}
            className={`tray-item tray-item-drag ${state === "ex" ? "excluded" : ""} ${draggingId === id ? "tray-item-dragging" : ""}`}
            draggable={state !== "ex"}
            onDragStart={e => {
              e.dataTransfer.setData("photoId", String(id));
              e.dataTransfer.effectAllowed = "copy";
              setDraggingId(id);
              onDragStart(id);
            }}
            onDragEnd={() => { setDraggingId(null); onDragEnd(); }}
            onClick={() => state !== "ex" && onPlace(id)}
            onContextMenu={e => { e.preventDefault(); onToggleExclude(id); }}>
            <img src={p.url} alt="" loading="lazy" draggable={false} />
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
