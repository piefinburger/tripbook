import TripSettings from "@/components/TripSettings";
export default function TripSettingsPage({ params }) {
  return <TripSettings tripId={params.id} />;
}
