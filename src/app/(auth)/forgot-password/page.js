"use client";

import { useState } from "react";
import Link from "next/link";
import { Btn } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to request a reset link");
      setMessage(data.message);
    } catch (err) {
      setError(err.message || "Unable to request a reset link");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthPage>
      <h1 style={headingSt}>Forgot your password?</h1>
      <p style={copySt}>Enter your work email and we’ll send you a secure reset link.</p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelSt}>Email address</label>
          <input type="email" value={email} required autoFocus autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@corp.io" style={inputSt} />
        </div>
        {error && <Notice type="error">{error}</Notice>}
        {message && <Notice type="success">{message}</Notice>}
        <Btn type="submit" loading={isLoading} size="lg" style={{ width: "100%", justifyContent: "center" }}>Send reset link</Btn>
      </form>
      <Link href="/login" style={backLinkSt}>← Back to sign in</Link>
    </AuthPage>
  );
}

function AuthPage({ children }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, backgroundColor: "var(--bg)", backgroundImage: "radial-gradient(ellipse at 20% 50%,rgba(79,142,247,.08),transparent 55%),radial-gradient(ellipse at 85% 20%,rgba(124,92,252,.08),transparent 55%)" }}>
      <section style={{ width: "100%", maxWidth: 460, padding: 36, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 30 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,var(--accent),var(--accent2))", display: "grid", placeItems: "center", boxShadow: "var(--shadow-accent)" }}>🏢</div>
          <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 20 }}>CorpHQ</span>
        </div>
        {children}
      </section>
    </main>
  );
}

function Notice({ type, children }) {
  const success = type === "success";
  return <div style={{ padding: "11px 14px", fontSize: 13, lineHeight: 1.5, color: success ? "var(--success)" : "var(--danger)", background: success ? "rgba(34,197,94,.1)" : "rgba(240,68,68,.1)", border: `1px solid ${success ? "rgba(34,197,94,.22)" : "rgba(240,68,68,.22)"}`, borderRadius: "var(--radius-sm)" }}>{children}</div>;
}

const headingSt = { fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 800, lineHeight: 1.15 };
const copySt = { color: "var(--text2)", fontSize: 14, lineHeight: 1.6, marginTop: 8, marginBottom: 26 };
const labelSt = { fontSize: 13, color: "var(--text2)", fontWeight: 500, display: "block", marginBottom: 6 };
const inputSt = { width: "100%", padding: "12px 14px", fontSize: 14, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text)", outline: "none" };
const backLinkSt = { display: "block", textAlign: "center", color: "var(--text2)", fontSize: 13, textDecoration: "none", marginTop: 22 };
