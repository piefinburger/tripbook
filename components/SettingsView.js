"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

const TASK_LABELS = {
  narrative: ["Book writing", "Generates the whole book and big rewrites"],
  page_edit: ["Page edits", "Captions, single-page fixes, small changes"],
  vision_curation: ["Photo judging", "Scores photos for Best Pictures (needs image support)"],
  transcribe_polish: ["Note cleanup", "Tidies dictated notes when saved (optional)"]
};

export default function SettingsView() {
  const [s, setS] = useState(null);
  const [models, setModels] = useState({});   // task -> {anthropic, openrouter}
  const [prompts, setPrompts] = useState(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [scoring, setScoring] = useState(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/settings").then(r => r.json());
    setS(j.settings);
    const p = await fetch("/api/settings/prompts").then(r => r.json());
    setPrompts(p.prompts);
    const perTask = {};
    for (const task of Object.keys(TASK_LABELS))
      perTask[task] = await fetch(`/api/settings/models?task=${task}`).then(r => r.json());
    setModels(perTask);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!s?.best_pictures_enabled) return;
    const t = setInterval(async () => {
      setScoring(await fetch("/api/settings/score-photos").then(r => r.json()));
    }, 4000);
    return () => clearInterval(t);
  }, [s?.best_pictures_enabled]);

  async function put(patch) {
    const next = { ...s, ...patch };
    setS(next);
    await fetch("/api/settings", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
  }
  async function saveKey() {
    setMsg("");
    const r = await fetch("/api/settings/openrouter-key", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const j = await r.json();
    if (!r.ok) { setMsg(j.error); return; }
    setKey(""); setMsg("OpenRouter key saved and verified.");
    load();
  }
  async function removeKey() {
    await fetch("/api/settings/openrouter-key", { method: "DELETE" });
    setMsg("OpenRouter key removed; all tasks are back on Anthropic defaults.");
    load();
  }
  async function savePrompt(task, block, content) {
    await fetch(`/api/settings/prompts/${task}/${block}`, { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    load();
  }
  async function resetPrompt(task, block) {
    await fetch(`/api/settings/prompts/${task}/${block}/reset`, { method: "POST" });
    load();
  }
  async function startScoring() {
    await fetch("/api/settings/score-photos", { method: "POST" });
    setScoring({ running: true, done: 0, total: 0 });
  }

  if (!s) return <main><p className="muted">Loading settings...</p></main>;
  const hasOR = !!s.openrouter_key_last4;

  return (<>
    <div className="topbar">
      <Link href="/" style={{ color: "#cfe3ec" }}>&larr; Trips</Link>
      <span className="brand">Settings</span><span />
    </div>
    <main className="wide">

      <section className="settings-section card">
        <h2>Models</h2>
        <p className="muted">Anthropic is built in. Add an OpenRouter key to
          route any task to any model.</p>
        {hasOR ? (
          <div className="row">
            <span className="pill">OpenRouter key ...{s.openrouter_key_last4}</span>
            <button className="small secondary" onClick={removeKey}>Remove</button>
          </div>
        ) : (
          <div className="row">
            <input value={key} onChange={e => setKey(e.target.value)}
              placeholder="sk-or-..." autoComplete="off" />
            <button className="small" onClick={saveKey} disabled={!key}>Save &amp; test</button>
          </div>
        )}
        {msg && <p className="muted">{msg}</p>}

        {Object.entries(TASK_LABELS).map(([task, [label, desc]]) => {
          const route = s.routing?.[task] || { provider: "anthropic", model: s.defaults[task] };
          const cat = models[task] || {};
          const list = route.provider === "openrouter" ? (cat.openrouter || []) : (cat.anthropic || []);
          return (
            <div className="task-row" key={task}>
              <div><b>{label}</b><div className="muted" style={{ fontSize: "0.8rem" }}>{desc}</div></div>
              <select value={route.provider} aria-label={`${label} provider`}
                onChange={e => put({ routing: { ...s.routing,
                  [task]: { provider: e.target.value,
                    model: e.target.value === "anthropic" ? s.defaults[task]
                      : (cat.openrouter?.[0]?.id || "") } } })}>
                <option value="anthropic">Anthropic</option>
                {hasOR && <option value="openrouter">OpenRouter</option>}
              </select>
              <select value={route.model} aria-label={`${label} model`}
                onChange={e => put({ routing: { ...s.routing,
                  [task]: { ...route, model: e.target.value } } })}>
                {list.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                {!list.some(m => m.id === route.model) &&
                  <option value={route.model}>{route.model}</option>}
              </select>
              <button className="small secondary"
                onClick={() => put({ routing: { ...s.routing,
                  [task]: { provider: "anthropic", model: s.defaults[task] } } })}>
                Reset</button>
            </div>);
        })}
      </section>

      <section className="settings-section card">
        <h2>Creation tuning</h2>
        <label>How selective should the book be?</label>
        <select value={s.curation_level}
          onChange={e => put({ curation_level: e.target.value })}>
          <option value="everything">Everything: include every usable photo</option>
          <option value="balanced">Balanced: skip duplicates and weak shots</option>
          <option value="highlights">Highlights only: a short book of standout moments</option>
        </select>

        <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
          <div>
            <b>Best pictures</b>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              AI scores every photo (0-100) and spots duplicates so generation
              and the editor tray can favor the strongest shots. One-time cost
              per photo, roughly a dollar or two per few hundred photos.</div>
          </div>
          <input type="checkbox" style={{ width: 24, height: 24 }}
            checked={s.best_pictures_enabled} aria-label="Enable best pictures"
            onChange={e => put({ best_pictures_enabled: e.target.checked })} />
        </div>
        {s.best_pictures_enabled && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="small" onClick={startScoring}
              disabled={scoring?.running}>
              {scoring?.running ? `Scoring ${scoring.done} of ${scoring.total}...` : "Score unscored photos"}
            </button>
          </div>)}

        <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
          <div>
            <b>Note cleanup on save</b>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              Fixes dictation artifacts and typos when a note is saved. Word
              choice and meaning are preserved; the original is what you see
              in the editor before saving.</div>
          </div>
          <input type="checkbox" style={{ width: 24, height: 24 }}
            checked={s.transcribe_polish_enabled} aria-label="Enable note cleanup"
            onChange={e => put({ transcribe_polish_enabled: e.target.checked })} />
        </div>
      </section>

      <section className="settings-section card">
        <h2>Prompts</h2>
        <p className="muted">The dimmed scaffold is fixed: it carries the
          output format and safety rules. The editable blocks steer voice and
          taste; they are yours.</p>
        {prompts && Object.entries(prompts).map(([task, data]) => (
          <PromptPanel key={task} task={task} label={TASK_LABELS[task][0]}
            data={data} onSave={savePrompt} onReset={resetPrompt} />
        ))}
      </section>
    </main>
  </>);
}

function PromptPanel({ task, label, data, onSave, onReset }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}>
        <b>{label}</b>
        <span className="muted">{open ? "Hide" : "Show"}
          {Object.values(data.blocks).some(b => b.overridden) &&
            <span className="pill" style={{ marginLeft: 8 }}>customized</span>}
        </span>
      </div>
      {open && (<>
        {Object.entries(data.blocks).map(([block, b]) => (
          <div className="steer-block" key={block}>
            <label>{block} {b.overridden && <span className="pill">edited</span>}</label>
            <textarea rows={4}
              value={drafts[block] ?? b.content}
              onChange={e => setDrafts(d => ({ ...d, [block]: e.target.value }))} />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="small"
                disabled={(drafts[block] ?? b.content) === b.content}
                onClick={() => onSave(task, block, drafts[block])}>Save block</button>
              {b.overridden &&
                <button className="small secondary"
                  onClick={() => { setDrafts(d => ({ ...d, [block]: undefined })); onReset(task, block); }}>
                  Reset to default</button>}
            </div>
          </div>
        ))}
        <label>Full assembled prompt (scaffold locked)</label>
        <div className="scaffold">{data.assembled}</div>
      </>)}
    </div>
  );
}
