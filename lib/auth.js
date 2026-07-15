import crypto from "crypto";
import { cookies } from "next/headers";
import { q } from "./db";

const SECRET = () => process.env.SESSION_SECRET || "dev-secret";

export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function verify(token) {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  if (p.exp < Date.now()) return null;
  return p;
}
export function setSession(res, user) {
  const token = sign({ uid: user.id, email: user.email, exp: Date.now() + 30 * 864e5 });
  res.cookies.set("tb_session", token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 86400
  });
}
export async function currentUser() {
  const token = cookies().get("tb_session")?.value;
  const p = verify(token);
  if (!p) return null;
  const rows = await q("SELECT id, email, name FROM users WHERE id=$1", [p.uid]);
  return rows[0] || null;
}
export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  return u;
}
export async function requireMember(tripId, userId) {
  const rows = await q(
    "SELECT role FROM trip_members WHERE trip_id=$1 AND user_id=$2", [tripId, userId]);
  if (!rows[0]) throw new Response(JSON.stringify({ error: "not a trip member" }), { status: 403 });
  return rows[0].role;
}
export function newToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}
export const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

// Site admins (comma-separated emails in ADMIN_EMAILS) can moderate every
// trip and delete trips. Trip owners and trip admins moderate their trip.
export function isSiteAdmin(user) {
  return (process.env.ADMIN_EMAILS || "").toLowerCase().split(",")
    .map(s => s.trim()).filter(Boolean)
    .includes((user?.email || "").toLowerCase());
}
export function canModerate(tripRole, user) {
  return tripRole === "owner" || tripRole === "admin" || isSiteAdmin(user);
}

// Viewers see the timeline and gallery but add, edit, and delete nothing,
// and never see book drafts or exports.
export function canContribute(tripRole) {
  return ["owner", "admin", "member"].includes(tripRole);
}
