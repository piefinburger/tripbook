import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { DEFAULT_MODELS } from "@/lib/llm";

const TASKS = ["narrative", "page_edit", "vision_curation", "transcribe_polish"];

export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [s] = await q("SELECT * FROM user_settings WHERE user_id=$1", [u.id]);
  return NextResponse.json({ settings: {
    routing: s?.routing || {},
    defaults: DEFAULT_MODELS,
    curation_level: s?.curation_level || "balanced",
    best_pictures_enabled: !!s?.best_pictures_enabled,
    transcribe_polish_enabled: !!s?.transcribe_polish_enabled,
    openrouter_key_last4: s?.openrouter_key_last4 || null
  } });
}

export async function PUT(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const routing = {};
  for (const t of TASKS) {
    const r = body.routing?.[t];
    if (r?.provider && r?.model &&
        ["anthropic", "openrouter"].includes(r.provider))
      routing[t] = { provider: r.provider, model: String(r.model).slice(0, 120) };
  }
  const cur = ["everything", "balanced", "highlights"].includes(body.curation_level)
    ? body.curation_level : "balanced";
  await q(
    `INSERT INTO user_settings (user_id, routing, curation_level,
       best_pictures_enabled, transcribe_polish_enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_id) DO UPDATE SET routing=$2, curation_level=$3,
       best_pictures_enabled=$4, transcribe_polish_enabled=$5, updated_at=now()`,
    [u.id, JSON.stringify(routing), cur,
     !!body.best_pictures_enabled, !!body.transcribe_polish_enabled]);
  return NextResponse.json({ ok: true });
}
