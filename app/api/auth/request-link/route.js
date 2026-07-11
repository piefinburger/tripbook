import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { newToken } from "@/lib/auth";
import { sendMagicLink } from "@/lib/ses";

export async function POST(req) {
  const { email, inviteCode } = await req.json();
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  let tripId = null, tripName = null;
  if (inviteCode) {
    const [t] = await q("SELECT id, name FROM trips WHERE invite_code=$1", [inviteCode]);
    if (t) { tripId = t.id; tripName = t.name; }
  }
  const { raw, hash } = newToken();
  await q(
    `INSERT INTO login_tokens (token_hash, email, invite_trip_id, expires_at)
     VALUES ($1,$2,$3, now() + interval '15 minutes')`, [hash, e, tripId]);
  const link = `${process.env.APP_URL}/api/auth/verify?token=${raw}`;
  try {
    await sendMagicLink(e, link, tripName);
  } catch (err) {
    console.error("SES send failed", err);
    return NextResponse.json(
      { error: "Couldn't send the email. Check the address and try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
