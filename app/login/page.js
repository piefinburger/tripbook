"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setErr("");
    const r = await fetch("/api/auth/request-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    setBusy(false);
    if (r.ok) setSent(true);
    else setErr((await r.json()).error || "Something went wrong.");
  }

  return (
    <main style={{ paddingTop: 60 }}>
      <h1 style={{ textAlign: "center" }}>tripbook</h1>
      <p className="muted" style={{ textAlign: "center" }}>
        Your family&apos;s shared vacation journal
      </p>
      <div className="card">
        {params.get("expired") && (
          <p className="error">That link expired or was already used. Request a new one.</p>
        )}
        {sent ? (
          <p>Check your email. Your sign-in link is on its way to <b>{email}</b>.
             It works once and expires in 15 minutes.</p>
        ) : (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" />
            {err && <p className="error">{err}</p>}
            <div style={{ marginTop: 12 }}>
              <button onClick={send} disabled={busy || !email}>
                {busy ? "Sending..." : "Email me a sign-in link"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
export default function Login() {
  return <Suspense><LoginForm /></Suspense>;
}
