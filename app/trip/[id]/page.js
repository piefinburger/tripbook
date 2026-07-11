import TripView from "@/components/TripView";
export default function TripPage({ params }) {
  return <TripView tripId={params.id} />;
}
