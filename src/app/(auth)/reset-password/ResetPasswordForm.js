"use client";

import { useState } from "react";
import Link from "next/link";
import { Btn } from "@/components/ui";

export default function ResetPasswordForm({ token }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is invalid or incomplete.");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmation) return setError("Passwords do not match.");

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to reset password");
      setSuccess(true);
      setPassword("");
      setConfirmation("");
    } catch (err) {
      setError(err.message || "Unable to reset password");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={pageSt}>
      <section style={cardSt}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 30 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,var(--accent),var(--accent2))", display: "grid", placeItems: "center", boxShadow: "var(--shadow-accent)" }}>🏢</div>
          <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 20 }}>CorpHQ</span>
        </div>
        <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 800, lineHeight: 1.15 }}>{success ? "Password reset" : "Choose a new password"}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14, lineHeight: 1.6, marginTop: 8, marginBottom: 26 }}>
          {success ? "Your password has been updated and existing sessions have been signed out." : "Use at least 8 characters for your new password."}
        </p>

        {success ? (
          <Link href="/login" style={primaryLinkSt}>Continue to sign in →</Link>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <PasswordField label="New password" value={password} onChange={setPassword} />
            <PasswordField label="Confirm new password" value={confirmation} onChange={setConfirmation} />
            {error && <div style={errorSt}>{error}</div>}
            <Btn type="submit" disabled={!token} loading={isLoading} size="lg" style={{ width: "100%", justifyContent: "center" }}>Reset password</Btn>
          </form>
        )}

        {!success && <Link href="/forgot-password" style={backLinkSt}>Request a new link</Link>}
      </section>
    </main>
  );
}

function PasswordField({ label, value, onChange }) {
  return (
    <div>
      <label style={labelSt}>{label}</label>
      <input type="password" value={value} required maxLength={128} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} style={inputSt} />
    </div>
  );
}

const pageSt = { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, backgroundColor: "var(--bg)", backgroundImage: "radial-gradient(ellipse at 20% 50%,rgba(79,142,247,.08),transparent 55%),radial-gradient(ellipse at 85% 20%,rgba(124,92,252,.08),transparent 55%)" };
const cardSt = { width: "100%", maxWidth: 460, padding: 36, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" };
const labelSt = { fontSize: 13, color: "var(--text2)", fontWeight: 500, display: "block", marginBottom: 6 };
const inputSt = { width: "100%", padding: "12px 14px", fontSize: 14, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text)", outline: "none" };
const errorSt = { padding: "11px 14px", fontSize: 13, color: "var(--danger)", background: "rgba(240,68,68,.1)", border: "1px solid rgba(240,68,68,.22)", borderRadius: "var(--radius-sm)" };
const primaryLinkSt = { display: "block", padding: "12px 16px", textAlign: "center", color: "white", background: "var(--accent)", borderRadius: "var(--radius-md)", textDecoration: "none", fontWeight: 600 };
const backLinkSt = { display: "block", textAlign: "center", color: "var(--text2)", fontSize: 13, textDecoration: "none", marginTop: 22 };
