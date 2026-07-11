import GalleryView from "@/components/GalleryView";
export default function GalleryPage({ params }) {
  return <GalleryView tripId={params.id} />;
}
