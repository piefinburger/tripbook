import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import TripList from "@/components/TripList";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.name) redirect("/welcome");
  return (
    <>
      <div className="topbar">
        <span className="brand">tripbook</span>
        <span className="row" style={{ gap: 14 }}>
          <Link href="/settings" style={{ color: "#cfe3ec" }}>Settings</Link>
          <span className="muted" style={{ color: "#cfe3ec" }}>{user.name}</span>
        </span>
      </div>
      <main>
        <TripList />
      </main>
    </>
  );
}
