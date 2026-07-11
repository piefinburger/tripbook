import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { TASKS, getBlocks, assembleSystem } from "@/lib/prompts";

export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const out = {};
  for (const task of TASKS) {
    out[task] = {
      blocks: await getBlocks(u.id, task),
      assembled: await assembleSystem(u.id, task, { mode: "auto" })
    };
  }
  return NextResponse.json({ prompts: out });
}
