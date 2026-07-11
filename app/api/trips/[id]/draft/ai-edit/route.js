import { NextResponse } from "next/server";
import { currentUser, requireMember } from "@/lib/auth";
import { aiEdit } from "@/lib/book";

export async function POST(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const { instruction, scope } = await req.json();
  if (!instruction?.trim())
    return NextResponse.json({ error: "Tell the assistant what to change." }, { status: 400 });
  try {
    const result = await aiEdit(u.id, params.id, instruction.trim(), scope || {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
