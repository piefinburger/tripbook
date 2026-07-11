import { q } from "@/lib/db";
import { verify } from "@/lib/auth";
import { presignGet } from "@/lib/s3";
import BookPages from "@/components/BookPages";

export const dynamic = "force-dynamic";

// Fetched only by headless Chromium on localhost with a short-lived signed
// token (see lib/pdf.js). Uses original photos for print resolution.
export default async function Render({ params, searchParams }) {
  const p = verify(searchParams.t);
  if (!p || String(p.render) !== String(params.id)) return <div>Forbidden</div>;
  const [ex] = await q("SELECT * FROM book_exports WHERE id=$1", [params.id]);
  if (!ex?.layout_spec) return <div>No spec</div>;

  const photos = await q(
    "SELECT id, s3_key FROM photos WHERE trip_id=$1 AND status='ready'", [ex.trip_id]);
  const photoUrls = {};
  for (const p2 of photos) photoUrls[p2.id] = await presignGet(p2.s3_key);

  return (
    <html><body style={{ margin: 0 }}>
      <BookPages spec={ex.layout_spec} photoUrls={photoUrls} print />
    </body></html>
  );
}
