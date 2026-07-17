// Image derivative tiers. One place so the upload path and the backfill
// script can never drift apart.
//   thumb   640px  q62  (~25KB)  grids: timeline, gallery, editor tray
//   preview 1600px q78 (~250KB)  lightbox, on-screen book preview
//   original                     downloads, book PDF export
import sharp from "sharp";
import { getObjectBuffer, putObject } from "./s3";

export const THUMB_WIDTH = 640;
export const PREVIEW_WIDTH = 1600;

export function derivativeKeys(s3Key) {
  const base = s3Key.replace(/^originals\//, "").replace(/\.\w+$/, "");
  return { previewKey: `previews/${base}.webp`, thumbKey: `thumbs/${base}.webp` };
}

// Build and upload both tiers from an original image buffer.
export async function makeDerivatives(buf, s3Key) {
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const { previewKey, thumbKey } = derivativeKeys(s3Key);
  const preview = await img.clone()
    .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 }).toBuffer();
  const thumb = await img.clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 62 }).toBuffer();
  await putObject(previewKey, preview, "image/webp");
  await putObject(thumbKey, thumb, "image/webp");
  return { previewKey, thumbKey, width: meta.width || null, height: meta.height || null };
}

// Videos: the client uploads a poster frame as the preview; derive the
// thumb tier from that poster.
export async function makeThumbFromPoster(posterKey) {
  const buf = await getObjectBuffer(posterKey);
  const thumbKey = posterKey.replace(/^previews\//, "thumbs/").replace(/\.\w+$/, ".webp");
  const thumb = await sharp(buf, { failOn: "none" })
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 62 }).toBuffer();
  await putObject(thumbKey, thumb, "image/webp");
  return thumbKey;
}
