import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getObjectBuffer } from "@/lib/s3";
import { makeDerivatives, makeThumbFromPoster } from "@/lib/derivatives";
import { reverseGeocode } from "@/lib/geocode";
import { emitTrip } from "@/lib/events";

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
    let tk = null;
    if (pk) { try { tk = await makeThumbFromPoster(pk); } catch { /* grid falls back to poster */ } }
    await q(
      `UPDATE photos SET status='ready', preview_key=$2, thumb_key=$3,
              width=$4, height=$5, place_name=$6 WHERE id=$1`,
      [photoId, pk, tk, (width | 0) || null, (height | 0) || null, place]);
    emitTrip(p.trip_id);
    return NextResponse.json({ ok: true, placeName: place });
  }

  const buf = await getObjectBuffer(p.s3_key);
  const d = await makeDerivatives(buf, p.s3_key);
  await q(
    `UPDATE photos SET status='ready', preview_key=$2, thumb_key=$3,
            width=$4, height=$5, place_name=$6 WHERE id=$1`,
    [photoId, d.previewKey, d.thumbKey, d.width, d.height, place]);
  emitTrip(p.trip_id);
  return NextResponse.json({ ok: true, placeName: place });
}
