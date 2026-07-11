import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ user: await currentUser() });
}
export async function PATCH(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await req.json();
  await q("UPDATE users SET name=$1 WHERE id=$2", [String(name || "").trim().slice(0, 60), u.id]);
  return NextResponse.json({ ok: true });
}
