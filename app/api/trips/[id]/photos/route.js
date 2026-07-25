import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, isSiteAdmin } from "@/lib/auth";
import { urlsForPhotos } from "@/lib/photoUrls";
import { searchPlace } from "@/lib/geocode";
import { emitTrip } from "@/lib/events";

// Full photo list for the editor tray, with scores and previews.
export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await requireMember(params.id, u.id); } catch (r) { return r; }
  const photos = await q(
    `SELECT p.id, p.ts, p.place_name, p.preview_key, p.thumb_key, p.width, p.height,
            p.quality, p.dup_group, u.name AS author
     FROM photos p JOIN users u ON u.id=p.user_id
     WHERE p.trip_id=$1 AND p.status='ready' AND p.kind='photo' ORDER BY p.ts`, [params.id]);
  const urls = await urlsForPhotos(photos, ["thumb", "preview"]);
  for (const p of photos) {
    p.id = Number(p.id);
    p.url = urls[p.id]?.thumb || null;       // tray thumbnail
    p.previewUrl = urls[p.id]?.preview || null; // canvas display
    delete p.preview_key; delete p.thumb_key;
  }
  return NextResponse.json({ photos });
}

// Bulk-update location for a set of photos (owner/admin only).
// Body: { photoIds: number[], placeName: string }
export async function PATCH(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response && !isSiteAdmin(u)) return role;
  if (role !== "owner" && role !== "admin" && !isSiteAdmin(u))
    return NextResponse.json({ error: "Owner or admin only." }, { status: 403 });

  const body = await req.json();

  // --- Bulk location update ---
  if (body.placeName != null) {
    const { photoIds, placeName } = body;
    if (!Array.isArray(photoIds) || photoIds.length === 0)
      return NextResponse.json({ error: "No photos selected." }, { status: 400 });
    if (!placeName?.trim())
      return NextResponse.json({ error: "Place name is required." }, { status: 400 });

    const geo = await searchPlace(placeName.trim());
    if (!geo) return NextResponse.json({ error: "Could not find that location. Try a more specific name." }, { status: 422 });

    await q(
      `UPDATE photos SET
         place_name              = $2,
         lat                     = $3,
         lng                     = $4,
         original_place_name     = COALESCE(original_place_name, place_name),
         original_lat            = COALESCE(original_lat, lat),
         original_lng            = COALESCE(original_lng, lng),
         location_updated_by_id  = $5
       WHERE id = ANY($1) AND trip_id = $6`,
      [photoIds.map(Number), geo.name, geo.lat, geo.lng, u.id, params.id]);

    await emitTrip(params.id);
    return NextResponse.json({ ok: true, appliedTo: photoIds.length, location: geo.name });
  }

  // --- Bulk timestamp update ---
  // Body: { timestamps: { [photoId]: isoString } }
  // Client computes new timestamps for each photo; server validates trip ownership.
  if (body.timestamps != null) {
    const entries = Object.entries(body.timestamps);
    if (!entries.length)
      return NextResponse.json({ error: "No timestamps provided." }, { status: 400 });

    const ids = entries.map(([id]) => Number(id));
    const tss = entries.map(([, ts]) => ts);

    // Validate all IDs belong to this trip before touching anything.
    const owned = await q(
      `SELECT id FROM photos WHERE id = ANY($1) AND trip_id = $2`,
      [ids, params.id]);
    if (owned.length !== ids.length)
      return NextResponse.json({ error: "One or more photos do not belong to this trip." }, { status: 403 });

    // Update each photo: freeze original_ts on first edit via COALESCE.
    await q(
      `UPDATE photos SET
         ts          = v.new_ts,
         original_ts = COALESCE(original_ts, photos.ts)
       FROM (
         SELECT unnest($1::BIGINT[]) AS id,
                unnest($2::TIMESTAMPTZ[]) AS new_ts
       ) v
       WHERE photos.id = v.id`,
      [ids, tss]);

    await emitTrip(params.id);
    return NextResponse.json({ ok: true, appliedTo: ids.length });
  }

  return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
}
