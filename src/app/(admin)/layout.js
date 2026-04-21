// src/app/(admin)/layout.js
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Spinner } from "@/components/ui";

function AdminGuard({ children }) {
  const { isHydrated, isLoggedIn, isAdmin } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isLoggedIn) { router.replace("/login"); return; }
    if (!isAdmin)    { router.replace("/employee/dashboard"); }
  }, [isHydrated, isLoggedIn, isAdmin, router]);

  if (!isHydrated) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <Spinner size={36} />
      </div>
    );
  }

  if (!isLoggedIn || !isAdmin) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 28, overflowY: "auto", minWidth: 0, background: "var(--bg)" }}>
        <div className="fade-in">{children}</div>
      </main>
    </div>
  );
}

export default function AdminLayout({ children }) {
  return <AdminGuard>{children}</AdminGuard>;
}
