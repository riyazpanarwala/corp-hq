// src/app/(employee)/layout.js
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuthContext } from "@/components/providers/AuthProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Spinner, ToastStack, useToast } from "@/components/ui";

function EmployeeGuard({ children }) {
  const { isHydrated, isLoggedIn, isEmployee } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isLoggedIn)  { router.replace("/login"); return; }
    if (!isEmployee)  { router.replace("/admin/dashboard"); }
  }, [isHydrated, isLoggedIn, isEmployee, router]);

  if (!isHydrated || !isLoggedIn || !isEmployee) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <Spinner size={36} />
      </div>
    );
  }
  return children;
}

export default function EmployeeLayout({ children }) {
  const { toasts, remove } = useToast();

  return (
    <AuthProvider>
      <EmployeeGuard>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar />
          <main style={{ flex: 1, padding: 28, overflowY: "auto", minWidth: 0, background: "var(--bg)" }}>
            <div className="fade-in">{children}</div>
          </main>
        </div>
        <ToastStack toasts={toasts} remove={remove} />
      </EmployeeGuard>
    </AuthProvider>
  );
}
