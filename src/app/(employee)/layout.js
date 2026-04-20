// src/app/(employee)/layout.js
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Spinner } from "@/components/ui";

function EmployeeGuard({ children }) {
  const { isHydrated, isLoggedIn, isEmployee } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    // CRITICAL FIX: Do NOT redirect until hydration is complete.
    // Previously this ran with stale (false) values causing redirect on first load.
    if (!isHydrated) return;
    if (!isLoggedIn)  { router.replace("/login"); return; }
    if (!isEmployee)  { router.replace("/admin/dashboard"); }
  }, [isHydrated, isLoggedIn, isEmployee, router]);

  // Still reading localStorage / awaiting token refresh — show spinner only, no redirect
  if (!isHydrated) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", background: "var(--bg)",
      }}>
        <Spinner size={36} />
      </div>
    );
  }

  // Redirect is in-flight (useEffect queued), render nothing to avoid flash
  if (!isLoggedIn || !isEmployee) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        flex: 1, padding: 28, overflowY: "auto",
        minWidth: 0, background: "var(--bg)",
      }}>
        <div className="fade-in">{children}</div>
      </main>
    </div>
  );
}

// CRITICAL FIX: Removed the extra <AuthProvider> wrapper that was here before.
// root layout.js (src/app/layout.js) already wraps the entire app in <AuthProvider>.
// Adding a second one here created a fresh, unauthenticated context — causing the
// guard to see isLoggedIn=false on first load and redirect back to /login.
export default function EmployeeLayout({ children }) {
  return <EmployeeGuard>{children}</EmployeeGuard>;
}
