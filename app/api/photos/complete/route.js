import { NextResponse } from "next/server";
import sharp from "sharp";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getObjectBuffer, putObject } from "@/lib/s3";
import { reverseGeocode } from "@/lib/geocode";

export async function POST(req) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { photoId, posterKey, width, height } = await req.json();
  const [p] = await q("SELECT * FROM photos WHERE id=$1 AND user_id=$2", [photoId, u.id]);
  if (!p) return NextResponse.json({ error: "Photo not found." }, { status: 404 });

  const place = await reverseGeocode(p.lat, p.lng);

  if (p.kind === "video") {
    // poster was uploaded by the client; trust-but-verify the key prefix
    const pk = posterKey?.startsWith(`previews/${p.trip_id}/`) ? posterKey : null;
    await q(
      `UPDATE photos SET status='ready', preview_key=$2, width=$3, height=$4, place_name=$5
       WHERE id=$1`,
      [photoId, pk, (width | 0) || null, (height | 0) || null, place]);
    return NextResponse.json({ ok: true, placeName: place });
  }

  const buf = await getObjectBuffer(p.s3_key);
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const previewKey = p.s3_key.replace(/^originals\//, "previews/").replace(/\.\w+$/, ".webp");
  const preview = await img.resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 78 }).toBuffer();
  await putObject(previewKey, preview, "image/webp");
  await q(
    `UPDATE photos SET status='ready', preview_key=$2, width=$3, height=$4, place_name=$5
     WHERE id=$1`,
    [photoId, previewKey, meta.width || null, meta.height || null, place]);
  return NextResponse.json({ ok: true, placeName: place });
}
