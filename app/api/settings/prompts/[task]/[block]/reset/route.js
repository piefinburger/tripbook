import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { DEFAULT_BLOCKS } from "@/lib/prompts";

export async function POST(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { task, block } = params;
  await q("DELETE FROM prompt_overrides WHERE user_id=$1 AND task=$2 AND block=$3",
    [u.id, task, block]);
  await q(
    "INSERT INTO prompt_revisions (user_id, task, block, content) VALUES ($1,$2,$3,$4)",
    [u.id, task, block, `[reset to default]`]);
  return NextResponse.json({ ok: true, content: DEFAULT_BLOCKS[task]?.[block] || "" });
}
