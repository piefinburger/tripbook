import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { TASKS, DEFAULT_BLOCKS } from "@/lib/prompts";

export async function PUT(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { task, block } = params;
  if (!TASKS.includes(task) || !(block in (DEFAULT_BLOCKS[task] || {})))
    return NextResponse.json({ error: "Unknown prompt block." }, { status: 404 });
  const { content } = await req.json();
  const text = String(content || "").slice(0, 4000);
  await q(
    `INSERT INTO prompt_overrides (user_id, task, block, content) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, task, block) DO UPDATE SET content=$4`,
    [u.id, task, block, text]);
  await q(
    "INSERT INTO prompt_revisions (user_id, task, block, content) VALUES ($1,$2,$3,$4)",
    [u.id, task, block, text]);
  return NextResponse.json({ ok: true });
}
