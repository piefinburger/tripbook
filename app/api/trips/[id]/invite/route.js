import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, newToken } from "@/lib/auth";
import { sendMagicLink } from "@/lib/ses";

export async function POST(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const { email } = await req.json();
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const [trip] = await q("SELECT name FROM trips WHERE id=$1", [params.id]);
  const { raw, hash } = newToken();
  await q(
    `INSERT INTO login_tokens (token_hash, email, invite_trip_id, expires_at)
     VALUES ($1,$2,$3, now() + interval '7 days')`, [hash, e, params.id]);
  await sendMagicLink(e, `${process.env.APP_URL}/api/auth/verify?token=${raw}`, trip.name);
  return NextResponse.json({ ok: true });
}
