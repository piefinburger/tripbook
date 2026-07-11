import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { scoreUserPhotos, scoringProgress } from "@/lib/book";

export async function POST() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  scoreUserPhotos(u.id); // fire and forget; poll GET
  return NextResponse.json({ ok: true });
}
export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(scoringProgress(u.id));
}
