// Provider abstraction (SPEC-AI-SETTINGS D1/D2/D9/D10). All AI calls route
// through complete(). Anthropic direct is the zero-config default;
// OpenRouter is opt-in per task from user_settings. LLM_MOCK=1 swaps in a
// deterministic mock for tests and offline development.
import Anthropic from "@anthropic-ai/sdk";
import { q } from "./db";
import { decryptSecret } from "./crypto";

export const DEFAULT_MODELS = {
  narrative: "claude-sonnet-4-6",
  page_edit: "claude-sonnet-4-6",
  vision_curation: "claude-haiku-4-5",
  transcribe_polish: "claude-haiku-4-5"
};

async function resolveRoute(userId, task) {
  const [s] = await q("SELECT routing, openrouter_key_enc FROM user_settings WHERE user_id=$1", [userId]);
  const route = s?.routing?.[task];
  if (route?.provider === "openrouter" && s?.openrouter_key_enc) {
    return { provider: "openrouter", model: route.model, key: decryptSecret(s.openrouter_key_enc) };
  }
  return { provider: "anthropic", model: route?.provider === "anthropic" && route.model
    ? route.model : DEFAULT_MODELS[task] };
}

// ---- Anthropic backend -----------------------------------------------------
async function callAnthropic({ model, system, messages, tools, maxTokens }) {
  const client = new Anthropic();
  const res = await client.messages.create({
    model, system, messages, max_tokens: maxTokens || 8000,
    ...(tools ? { tools, tool_choice: { type: "tool", name: tools[0].name } } : {})
  });
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const tu = res.content.find(b => b.type === "tool_use");
  return { text, toolCall: tu ? { name: tu.name, input: tu.input } : null };
}

// ---- OpenRouter backend (OpenAI wire format) -------------------------------
function toOpenAIMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push(m); continue; }
    // map anthropic content blocks (text, image) to openai parts
    out.push({
      role: m.role,
      content: m.content.map(b =>
        b.type === "text" ? { type: "text", text: b.text }
        : b.type === "image" ? { type: "image_url", image_url: {
            url: `data:${b.source.media_type};base64,${b.source.data}` } }
        : null).filter(Boolean)
    });
  }
  return out;
}
async function callOpenRouter({ key, model, system, messages, tools, maxTokens }) {
  const body = {
    model, max_tokens: maxTokens || 8000,
    messages: toOpenAIMessages(system, messages),
    ...(tools ? {
      tools: tools.map(t => ({ type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      tool_choice: { type: "function", function: { name: tools[0].name } }
    } : {})
  };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "", "X-Title": "Tripbook" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  const tc = msg.tool_calls?.[0];
  return {
    text: msg.content || "",
    toolCall: tc ? { name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}") } : null
  };
}

// ---- Mock backend (tests / offline dev) ------------------------------------
function callMock({ task, messages, tools }) {
  const userText = (() => {
    const m = messages[messages.length - 1];
    return typeof m.content === "string" ? m.content
      : m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  })();
  if (task === "narrative") {
    let ids = [];
    try { ids = (JSON.parse(userText).photos || []).map(p => p.id); } catch {}
    const pages = ids.slice(0, 3).map((id, i) => ({
      id: `pg_m${i}`, template: "full-bleed", photoIds: [id],
      caption: `Mock caption ${i + 1}`, text: "", pinned: false }));
    if (!pages.length) pages.push({ id: "pg_m0", template: "text-only",
      photoIds: [], caption: "", text: "A quiet day with no photos yet.", pinned: false });
    return { text: JSON.stringify({ version: 2, title: "Mock Family Book",
      subtitle: "A test run", chapters: [{ id: "ch_m0", title: "Day One",
      narrative: "Mock narrative.", pages }], excludedPhotoIds: [] }), toolCall: null };
  }
  if (task === "page_edit" && tools) {
    return { text: "", toolCall: { name: "apply_edits", input: {
      ops: [{ op: "set_meta", title: "Mock Edited Title" }],
      summary: "Mock edit applied." } } };
  }
  if (task === "vision_curation")
    return { text: JSON.stringify({ quality: 80, tags: ["mock", "beach"],
      description: "A mock beach scene." }), toolCall: null };
  return { text: userText.trim(), toolCall: null }; // transcribe_polish
}

// ---- Public interface ------------------------------------------------------
export async function complete(userId, task, { system, messages, tools, maxTokens } = {}) {
  if (process.env.LLM_MOCK === "1")
    return { ...callMock({ task, messages, tools }), provider: "mock", model: "mock" };

  const route = await resolveRoute(userId, task);
  const attempt = (r) => r.provider === "openrouter"
    ? callOpenRouter({ ...r, system, messages, tools, maxTokens })
    : callAnthropic({ ...r, system, messages, tools, maxTokens });

  try {
    return { ...(await attempt(route)), provider: route.provider, model: route.model };
  } catch (e1) {
    try { // retry once on the configured route
      return { ...(await attempt(route)), provider: route.provider, model: route.model };
    } catch (e2) {
      if (route.provider === "anthropic") throw e2; // no further fallback exists
      // fall back to anthropic default (D10)
      const fb = { provider: "anthropic", model: DEFAULT_MODELS[task] };
      const res = await attempt(fb);
      return { ...res, provider: fb.provider, model: fb.model, fallback: true,
        fallbackReason: String(e2.message || e2).slice(0, 200) };
    }
  }
}

// OpenRouter catalog for the model pickers (cached 24h in-process).
let catalogCache = { at: 0, models: null };
export async function openrouterCatalog(key) {
  if (catalogCache.models && Date.now() - catalogCache.at < 864e5) return catalogCache.models;
  const r = await fetch("https://openrouter.ai/api/v1/models",
    { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!r.ok) throw new Error(`OpenRouter catalog ${r.status}`);
  const j = await r.json();
  const models = (j.data || []).map(m => ({
    id: m.id, name: m.name,
    tools: !!(m.supported_parameters || []).includes("tools"),
    vision: (m.architecture?.input_modalities || m.architecture?.modality || "").includes("image")
  }));
  catalogCache = { at: Date.now(), models };
  return models;
}

export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tools: true, vision: true },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", tools: true, vision: true },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tools: true, vision: true }
];
