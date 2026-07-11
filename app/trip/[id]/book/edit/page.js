import BookEditor from "@/components/BookEditor";
export default function EditorPage({ params }) {
  return <BookEditor tripId={params.id} />;
}
