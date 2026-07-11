import crypto from "crypto";

function key() {
  const s = process.env.SETTINGS_SECRET;
  if (!s) throw new Error("SETTINGS_SECRET is not set");
  return crypto.createHash("sha256").update(s).digest();
}
export function encryptSecret(plain) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), nonce);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]);
}
export function decryptSecret(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const nonce = b.subarray(0, 12), tag = b.subarray(b.length - 16), ct = b.subarray(12, b.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key(), nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
