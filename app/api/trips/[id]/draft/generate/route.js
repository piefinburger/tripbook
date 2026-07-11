import { NextResponse } from "next/server";
import { currentUser, requireMember } from "@/lib/auth";
import { generateDraft } from "@/lib/book";

export async function POST(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner")
    return NextResponse.json({ error: "Only the trip owner can generate the book." }, { status: 403 });
  const { mode } = await req.json();
  if (!["auto", "curated"].includes(mode))
    return NextResponse.json({ error: "Pick a generation mode." }, { status: 400 });
  generateDraft(u.id, params.id, mode); // async; poll GET draft for status
  return NextResponse.json({ ok: true });
}
