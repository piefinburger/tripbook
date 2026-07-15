import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { hashToken, setSession } from "@/lib/auth";

export async function GET(req) {
  const token = new URL(req.url).searchParams.get("token");
  const rows = await q(
    `UPDATE login_tokens SET used_at=now()
     WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()
     RETURNING email, invite_trip_id, invite_role`, [hashToken(token || "")]);
  if (!rows[0])
    return NextResponse.redirect(new URL("/login?expired=1", process.env.APP_URL));

  const { email, invite_trip_id, invite_role } = rows[0];
  const [user] = await q(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email
     RETURNING id, email, name`, [email]);
  if (invite_trip_id) {
    await q(
      `INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [invite_trip_id, user.id, invite_role === "viewer" ? "viewer" : "member"]);
  }
  const dest = user.name ? (invite_trip_id ? `/trip/${invite_trip_id}` : "/") : "/welcome";
  const res = NextResponse.redirect(new URL(dest, process.env.APP_URL));
  setSession(res, user);
  return res;
}
