import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { openrouterCatalog, ANTHROPIC_MODELS } from "@/lib/llm";

// Filtered model catalog for a task's picker (D9).
export async function GET(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const task = new URL(req.url).searchParams.get("task") || "narrative";
  const needTools = ["narrative", "page_edit"].includes(task);
  const needVision = task === "vision_curation";
  const filter = (m) => (!needTools || m.tools) && (!needVision || m.vision);

  const out = { anthropic: ANTHROPIC_MODELS.filter(filter), openrouter: [] };
  const [s] = await q("SELECT openrouter_key_enc FROM user_settings WHERE user_id=$1", [u.id]);
  if (s?.openrouter_key_enc) {
    try {
      out.openrouter = (await openrouterCatalog(decryptSecret(s.openrouter_key_enc)))
        .filter(filter).slice(0, 400);
    } catch { out.openrouterError = "Could not load the OpenRouter catalog."; }
  }
  return NextResponse.json(out);
}
