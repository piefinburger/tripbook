#!/usr/bin/env node
// Local development sign-in. Magic-link emails cannot be delivered on a dev
// box, so this mints a login token directly and prints the verify URL.
//
//   npm run dev:login                 -> signs in as dev@local
//   npm run dev:login -- gma@local    -> signs in as anyone else
//
// Refuses to run against anything but a local database: this mints
// authentication tokens, and pointing it at production would be a way to
// hand out sessions for accounts you do not own.
import { readFileSync } from "fs";
import crypto from "crypto";
import pg from "pg";

// Next reads .env.local natively; a bare node script does not.
function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* fall back to the ambient environment */ }
}
loadEnvLocal();

const url = process.env.DATABASE_URL;
const appUrl = process.env.APP_URL || "http://localhost:3000";
if (!url) {
  console.error("DATABASE_URL is not set. Create .env.local (see docs/DEV.md).");
  process.exit(1);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.NODE_ENV === "production") {
  console.error("Refusing to run: DATABASE_URL is not local.\n  " + url.replace(/:[^:@]*@/, ":***@"));
  process.exit(1);
}

const email = (process.argv[2] || "dev@local").toLowerCase();
const pool = new pg.Pool({ connectionString: url });

const raw = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(raw).digest("hex");

let { rows } = await pool.query("SELECT id, name FROM users WHERE email=$1", [email]);
if (!rows.length) {
  ({ rows } = await pool.query(
    "INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id, name",
    [email, email.split("@")[0]]));
  console.log(`Created dev user ${email} (id ${rows[0].id}).`);
}
const user = rows[0];

await pool.query(
  "INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '15 minutes')",
  [hash, email]);

const { rows: trips } = await pool.query(
  `SELECT t.id, t.name, m.role FROM trip_members m JOIN trips t ON t.id=m.trip_id
   WHERE m.user_id=$1 ORDER BY t.id`, [user.id]);

console.log(`\nSigned in as ${user.name || email} (id ${user.id})`);
console.log(trips.length
  ? "Trips: " + trips.map(t => `${t.name} [${t.role}] -> ${appUrl}/trip/${t.id}`).join("\n       ")
  : "No trips yet for this user.");
console.log(`\nOpen this URL (valid 15 minutes, single use):\n${appUrl}/api/auth/verify?token=${raw}\n`);

await pool.end();
