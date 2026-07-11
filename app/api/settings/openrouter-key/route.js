import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { openrouterCatalog } from "@/lib/llm";

export async function PUT(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { key } = await req.json();
  if (!key?.startsWith("sk-or-"))
    return NextResponse.json({ error: "That does not look like an OpenRouter key (sk-or-...)." }, { status: 400 });
  if (process.env.LLM_MOCK !== "1") {
    try { await openrouterCatalog(key); } // live proof-of-life before saving
    catch { return NextResponse.json({ error: "OpenRouter rejected that key." }, { status: 400 }); }
  }
  await q(
    `INSERT INTO user_settings (user_id, openrouter_key_enc, openrouter_key_last4)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET openrouter_key_enc=$2, openrouter_key_last4=$3, updated_at=now()`,
    [u.id, encryptSecret(key), key.slice(-4)]);
  return NextResponse.json({ ok: true, last4: key.slice(-4) });
}

export async function DELETE() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await q(
    `UPDATE user_settings SET openrouter_key_enc=NULL, openrouter_key_last4=NULL,
       routing='{}'::jsonb, updated_at=now() WHERE user_id=$1`, [u.id]);
  return NextResponse.json({ ok: true });
}
