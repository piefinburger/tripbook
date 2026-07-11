"use client";
import { useState } from "react";
import { useParams } from "next/navigation";

export default function Join() {
  const { code } = useParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setErr("");
    const r = await fetch("/api/auth/request-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, inviteCode: code })
    });
    if (r.ok) setSent(true);
    else setErr((await r.json()).error || "Something went wrong.");
  }

  return (
    <main style={{ paddingTop: 60 }}>
      <h1 style={{ textAlign: "center" }}>Join the trip</h1>
      <div className="card">
        {sent ? (
          <p>Check your email for your sign-in link. After you sign in, add
          Tripbook to your home screen: tap Share, then
          &quot;Add to Home Screen.&quot;</p>
        ) : (
          <>
            <p>Enter your email and we&apos;ll send you a link. No password needed.</p>
            <input type="email" inputMode="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            {err && <p className="error">{err}</p>}
            <div style={{ marginTop: 12 }}>
              <button onClick={send} disabled={!email}>Send my link</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
