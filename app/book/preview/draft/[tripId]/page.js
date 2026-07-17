import Link from "next/link";
import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentUser, requireMember, canContribute } from "@/lib/auth";
import { urlsForPhotos } from "@/lib/photoUrls";
import { getOrNullDraft } from "@/lib/book";
import { ensureV2 } from "@/lib/specops";
import BookPages from "@/components/BookPages";

export const dynamic = "force-dynamic";

export default async function DraftPreview({ params }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const role = await requireMember(params.tripId, u.id);
  if (!canContribute(role)) redirect(`/trip/${params.tripId}`);
  const draft = await getOrNullDraft(params.tripId);
  if (!draft?.spec?.chapters) return <main><p>Nothing to preview yet.</p></main>;
  const photos = await q(
    "SELECT id, preview_key FROM photos WHERE trip_id=$1 AND status='ready' AND kind='photo'", [params.tripId]);
  const urls = await urlsForPhotos(photos, ["preview"]);
  const photoUrls = {};
  for (const p of photos) photoUrls[Number(p.id)] = urls[Number(p.id)]?.preview || null;
  return (<>
    <div className="topbar">
      <Link href={`/trip/${params.tripId}/book/edit`} style={{ color: "#cfe3ec" }}>&larr; Editor</Link>
      <span className="brand">Draft preview</span><span />
    </div>
    <main style={{ maxWidth: "9in" }}>
      <p className="muted">On-screen preview uses compressed photos; the
        exported PDF uses full-resolution originals.</p>
      <BookPages spec={ensureV2(draft.spec)} photoUrls={photoUrls} />
    </main>
  </>);
}
