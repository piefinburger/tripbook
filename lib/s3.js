import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({ region: process.env.AWS_REGION });
export const BUCKET = process.env.S3_BUCKET;

export function presignPut(key, contentType) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn: 600 });
}
// opts.download: filename -> Content-Disposition attachment (Download original)
export function presignGet(key, opts = {}) {
  const expiresIn = typeof opts === "number" ? opts : (opts.expiresIn || 3600);
  const extra = opts.download
    ? { ResponseContentDisposition: `attachment; filename="${opts.download}"` } : {};
  return getSignedUrl(s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key, ...extra }), { expiresIn });
}
export async function getObjectBuffer(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}
export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
