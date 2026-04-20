// src/app/(auth)/login/page.js
"use client";
import { useState, useEffect } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Btn, Divider, Spinner } from "@/components/ui";

const DEMO = [
  {
    email: "sarah@corp.io",
    name: "Sarah Chen",
    role: "Admin",
    initials: "SC",
    color: "#4f8ef7",
  },
  {
    email: "marcus@corp.io",
    name: "Marcus Webb",
    role: "Employee",
    initials: "MW",
    color: "#7c5cfc",
  },
  {
    email: "priya@corp.io",
    name: "Priya Sharma",
    role: "Employee",
    initials: "PS",
    color: "#22d3a5",
  },
  {
    email: "jordan@corp.io",
    name: "Jordan Lee",
    role: "Employee",
    initials: "JL",
    color: "#f5a623",
  },
];

export default function LoginPage() {
  const { login, isLoading } = useAuthContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Fix hydration: Add mounted state
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    setError("");
    const result = await login(email.trim().toLowerCase(), password);
    if (!result.success) setError(result.error || "Login failed");
  };

  // Don't render dynamic content during SSR to prevent hydration mismatch
  if (!mounted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "40px 36px",
            margin: "0 auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 36,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg,var(--accent),var(--accent2))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              🏢
            </div>
            <span
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 800,
                fontSize: 20,
              }}
            >
              CorpHQ
            </span>
          </div>
          <h2
            style={{
              fontFamily: "Syne, sans-serif",
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1.1,
            }}
          >
            Welcome back
          </h2>
          <p
            style={{
              color: "var(--text2)",
              fontSize: 14,
              marginTop: 6,
              marginBottom: 28,
            }}
          >
            Sign in to your portal account.
          </p>
          <div style={{ height: 200 }} /> {/* Placeholder for form */}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--bg)",
        backgroundImage:
          "radial-gradient(ellipse at 15% 50%,rgba(79,142,247,.07) 0%,transparent 55%),radial-gradient(ellipse at 85% 20%,rgba(124,92,252,.07) 0%,transparent 55%)",
      }}
    >
      {/* Left branding */}
      <div
        className="login-left"
        style={{
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 64px",
          borderRight: "1px solid var(--border)",
          background:
            "linear-gradient(160deg,rgba(79,142,247,.04) 0%,transparent 60%)",
          display: "none",
        }}
      >
        <Logo size={52} />
        <h1
          style={{
            fontFamily: "Syne, sans-serif",
            fontSize: 38,
            fontWeight: 800,
            lineHeight: 1.1,
            marginTop: 24,
          }}
        >
          Employee
          <br />
          Management
          <br />
          Portal
        </h1>
        <p
          style={{
            color: "var(--text2)",
            fontSize: 15,
            marginTop: 16,
            maxWidth: 320,
            lineHeight: 1.7,
          }}
        >
          Track attendance, manage leave requests, and monitor your team — all
          in one place.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 36,
          }}
        >
          {[
            "Real-time check-in / check-out",
            "Leave approval workflow",
            "Monthly analytics & CSV export",
            "Role-based access control",
          ].map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 14,
                color: "var(--text2)",
              }}
            >
              <span
                style={{ color: "var(--success)", fontSize: 16, flexShrink: 0 }}
              >
                ✓
              </span>{" "}
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Right form */}
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "40px 36px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 36,
          }}
        >
          <Logo size={36} />
          <span
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            CorpHQ
          </span>
        </div>

        <h2
          style={{
            fontFamily: "Syne, sans-serif",
            fontSize: 26,
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          Welcome back
        </h2>
        <p
          style={{
            color: "var(--text2)",
            fontSize: 14,
            marginTop: 6,
            marginBottom: 28,
          }}
        >
          Sign in to your portal account.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div>
            <label style={labelSt}>Email address</label>
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@corp.io"
              style={inputSt}
            />
          </div>
          <div>
            <label style={labelSt}>Password</label>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputSt}
            />
          </div>
          {error && (
            <div
              style={{
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--danger)",
                background: "rgba(240,68,68,.1)",
                border: "1px solid rgba(240,68,68,.22)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {error}
            </div>
          )}
          <Btn
            type="submit"
            loading={isLoading}
            size="lg"
            style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
          >
            Sign In →
          </Btn>
        </form>

        <div style={{ marginTop: 28 }}>
          <Divider label="Quick Demo Login" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 14,
            }}
          >
            {DEMO.map((acc) => (
              <DemoCard
                key={acc.email}
                account={acc}
                onSelect={() => {
                  setEmail(acc.email);
                  setPassword("password123");
                  setError("");
                }}
              />
            ))}
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--text3)",
              marginTop: 12,
              textAlign: "center",
            }}
          >
            All demo accounts: password{" "}
            <code style={{ color: "var(--accent)" }}>password123</code>
          </p>
        </div>
      </div>

      <style>{`@media(min-width:860px){.login-left{display:flex!important}}`}</style>
    </div>
  );
}

function Logo({ size = 36 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        flexShrink: 0,
        background: "linear-gradient(135deg,var(--accent),var(--accent2))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.46,
        boxShadow: "var(--shadow-accent)",
      }}
    >
      🏢
    </div>
  );
}

function DemoCard({ account, onSelect }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        background: hov ? "var(--surface2)" : "var(--surface)",
        border: "1px solid var(--border)",
        transition: "background .15s",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          flexShrink: 0,
          background: `${account.color}1a`,
          border: `2px solid ${account.color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: account.color,
        }}
      >
        {account.initials}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {account.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)" }}>
          {account.email}
        </div>
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          padding: "3px 8px",
          borderRadius: 6,
          color: account.role === "Admin" ? "var(--accent)" : "var(--success)",
          background:
            account.role === "Admin"
              ? "var(--accent-glow)"
              : "rgba(34,211,165,.1)",
        }}
      >
        {account.role}
      </span>
    </button>
  );
}

const labelSt = {
  fontSize: 13,
  color: "var(--text2)",
  fontWeight: 500,
  display: "block",
  marginBottom: 6,
};

const inputSt = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 14,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text)",
  transition: "border-color .15s",
  outline: "none",
};
