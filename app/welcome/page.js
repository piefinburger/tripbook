"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Welcome() {
  const [name, setName] = useState("");
  const router = useRouter();
  async function save() {
    await fetch("/api/me", { method: "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    router.replace("/");
  }
  return (
    <main style={{ paddingTop: 60 }}>
      <h1>Welcome to Tripbook</h1>
      <div className="card">
        <label htmlFor="name">What should the family call you?</label>
        <input id="name" value={name} onChange={e => setName(e.target.value)}
          placeholder="Dad, Mom, Alex..." autoFocus />
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={!name.trim()}>Continue</button>
        </div>
      </div>
      <div className="card">
        <b>Add Tripbook to your home screen</b>
        <p className="muted">In Safari: tap the Share button, then
        &quot;Add to Home Screen.&quot; This lets Tripbook work offline and keeps
        your photos safe until they sync.</p>
      </div>
    </main>
  );
}
