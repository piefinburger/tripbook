import { NextResponse } from "next/server";
import crypto from "crypto";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute } from "@/lib/auth";
import { presignPut } from "@/lib/s3";

const IMAGE = /^image\/(jpeg|png|heic|heif|webp)$/;
const VIDEO = /^video\/(mp4|quicktime|webm|x-m4v)$/;

export async function POST(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tripId, contentType, ts, lat, lng, kind, source, durationS } = await req.json();
  const role = await requireMember(tripId, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (!canContribute(role))
    return NextResponse.json({ error: "Viewers can look but not add. Ask the trip owner to make you a contributor." }, { status: 403 });

  const isVideo = kind === "video";
  if (isVideo ? !VIDEO.test(contentType || "") : !IMAGE.test(contentType || ""))
    return NextResponse.json({ error: isVideo
      ? "Unsupported video type." : "Unsupported image type." }, { status: 400 });

  const ext = isVideo
    ? (contentType === "video/quicktime" ? "mov" : contentType === "video/webm" ? "webm" : "mp4")
    : (contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg");
  const key = `originals/${tripId}/${crypto.randomUUID()}.${ext}`;
  const [row] = await q(
    `INSERT INTO photos (trip_id, user_id, s3_key, ts, lat, lng, kind, source, duration_s)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [tripId, u.id, key, ts || new Date().toISOString(), lat ?? null, lng ?? null,
     isVideo ? "video" : "photo", source === "library" ? "library" : "capture",
     isVideo ? (durationS | 0) || null : null]);
  const putUrl = await presignPut(key, contentType);
  // videos: the client renders a poster frame and uploads it as the preview
  let posterPutUrl = null, posterKey = null;
  if (isVideo) {
    posterKey = key.replace(/^originals\//, "previews/").replace(/\.\w+$/, ".jpg");
    posterPutUrl = await presignPut(posterKey, "image/jpeg");
  }
  return NextResponse.json({ photoId: row.id, putUrl, posterPutUrl, posterKey });
}
