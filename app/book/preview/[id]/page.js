import Link from "next/link";
import { q } from "@/lib/db";
import { currentUser, requireMember } from "@/lib/auth";
import { presignGet } from "@/lib/s3";
import BookPages from "@/components/BookPages";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Preview({ params }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const [ex] = await q("SELECT * FROM book_exports WHERE id=$1", [params.id]);
  if (!ex?.layout_spec) return <main><p>Nothing to preview yet.</p></main>;
  await requireMember(ex.trip_id, u.id);

  const photos = await q(
    "SELECT id, preview_key FROM photos WHERE trip_id=$1 AND status='ready'", [ex.trip_id]);
  const photoUrls = {};
  for (const p of photos) photoUrls[p.id] = await presignGet(p.preview_key);

  return (
    <>
      <div className="topbar">
        <Link href={`/trip/${ex.trip_id}/book`} style={{ color: "#cfe3ec" }}>&larr; Back</Link>
        <span className="brand">Preview</span><span />
      </div>
      <main style={{ maxWidth: "9in" }}>
        <p className="muted">On-screen preview uses compressed photos. The
        exported PDF uses full-resolution originals.</p>
        <BookPages spec={ex.layout_spec} photoUrls={photoUrls} />
      </main>
    </>
  );
}
