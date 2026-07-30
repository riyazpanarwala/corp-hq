// src/components/layout/Sidebar.js
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Avatar } from "@/components/ui";
import { useAuthContext } from "@/components/providers/AuthProvider";

const MOBILE_BREAKPOINT = 768;

const ADMIN_NAV = [
  { href: "/admin/dashboard", icon: "⚡", label: "Dashboard" },
  { href: "/admin/attendance", icon: "📋", label: "Attendance" },
  { href: "/admin/regularizations", icon: "🛠️", label: "Regularizations" },
  { href: "/admin/leaves", icon: "🗓️", label: "Leave Requests" },
  { href: "/admin/employees", icon: "👥", label: "Employees" },
  { href: "/admin/holidays", icon: "📆", label: "Holidays" },
  { href: "/admin/reports", icon: "📊", label: "Reports" },
];

const EMPLOYEE_NAV = [
  { href: "/employee/dashboard", icon: "⚡", label: "Dashboard" },
  { href: "/employee/attendance", icon: "🕐", label: "Attendance" },
  { href: "/employee/leaves", icon: "🗓️", label: "My Leaves" },
];

const MANAGER_NAV = [
  ...EMPLOYEE_NAV,
  { href: "/admin/attendance", icon: "👥", label: "Team Attendance" },
  { href: "/admin/leaves", icon: "✅", label: "Team Leaves" },
];

const COLORS = ["#4f8ef7", "#7c5cfc", "#22d3a5", "#f5a623", "#f04444"];

export function Sidebar() {
  const { user, logout, isAdmin, isManager } = useAuthContext();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

    const applyState = (matches) => {
      setIsMobile(matches);
      if (matches) setMobileOpen(false);
    };

    applyState(mq.matches);

    const handler = (e) => applyState(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  if (!user) return null;

  const nav = isAdmin ? ADMIN_NAV : isManager ? MANAGER_NAV : EMPLOYEE_NAV;
  const initials = user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = COLORS[user.id % COLORS.length];

  const effectiveCollapsed = isMobile ? false : collapsed;
  const W = isMobile ? 240 : (collapsed ? 64 : 220);

  return (
    <>
      <button
        className="sidebar-mobile-trigger"
        onClick={() => setMobileOpen(o => !o)}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        style={{
          display: "none",
          position: "fixed", top: 14, left: 14, zIndex: 210,
          width: 40, height: 40, borderRadius: 10,
          background: "var(--surface)", border: "1px solid var(--border)",
          color: "var(--text)", alignItems: "center", justifyContent: "center",
          fontSize: 18, cursor: "pointer", boxShadow: "var(--shadow-md)",
        }}
      >
        {mobileOpen ? "✕" : "☰"}
      </button>

      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 190 }}
        />
      )}

      <aside style={{
        width: W, minHeight: "100vh",
        background: "var(--surface)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        position: isMobile ? "fixed" : "sticky", top: 0, left: 0,
        flexShrink: 0, zIndex: 200,
        transform: isMobile ? `translateX(${mobileOpen ? "0" : "-100%"})` : "none",
        transition: isMobile
          ? "transform .25s cubic-bezier(.4,0,.2,1)"
          : "width .25s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{
          padding: effectiveCollapsed ? "18px 0" : "18px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center",
          justifyContent: effectiveCollapsed ? "center" : "space-between",
          minHeight: 64,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, overflow: "hidden" }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg,var(--accent),var(--accent2))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, boxShadow: "var(--shadow-accent)",
            }}>🏢</div>
            {!effectiveCollapsed && (
              <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)", display: "block", lineHeight: 1, marginBottom: 2 }}>
                  PANARWALA
                </span>
                <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 16, lineHeight: 1.1, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  CorpHQ
                </span>
              </div>
            )}
          </div>
          {!effectiveCollapsed && !isMobile && <CollapseBtn icon="◀" onClick={() => setCollapsed(true)} />}
          {isMobile && <CollapseBtn icon="✕" onClick={() => setMobileOpen(false)} />}
        </div>

        {effectiveCollapsed && (
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
            <CollapseBtn icon="▶" onClick={() => setCollapsed(false)} />
          </div>
        )}

        {!effectiveCollapsed && (
          <div style={{ padding: "10px 16px 4px" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
              color: isAdmin ? "var(--accent)" : "var(--success)",
              background: isAdmin ? "var(--accent-glow)" : "rgba(34,211,165,.1)",
              padding: "3px 8px", borderRadius: 6,
            }}>
              {isAdmin ? "Admin · HR" : isManager ? "Manager · Team" : user.department}
            </span>
          </div>
        )}

        <nav style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {nav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={effectiveCollapsed ? item.label : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: effectiveCollapsed ? "10px" : "10px 12px",
                  borderRadius: "var(--radius-sm)", textDecoration: "none",
                  background: active ? "var(--accent-glow)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text2)",
                  fontWeight: active ? 600 : 400, fontSize: 14,
                  justifyContent: effectiveCollapsed ? "center" : "flex-start",
                  borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                  transition: "all .15s",
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--surface2)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                {!effectiveCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
          {effectiveCollapsed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <Avatar initials={initials} size={32} color={color} />
              <LogoutBtn onClick={logout} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderRadius: "var(--radius-sm)" }}>
              <Avatar initials={initials} size={34} color={color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{user.designation || user.role?.toLowerCase()}</div>
              </div>
              <LogoutBtn onClick={logout} />
            </div>
          )}
        </div>
      </aside>

      <style>{`
        @media (max-width: ${MOBILE_BREAKPOINT}px) {
          .sidebar-mobile-trigger { display: flex !important; }
        }
      `}</style>
    </>
  );
}

function CollapseBtn({ onClick, icon }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 13, padding: "4px 6px", borderRadius: 6 }}>
      {icon}
    </button>
  );
}

function LogoutBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Logout"
      style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 17, padding: "4px", borderRadius: 6, flexShrink: 0, transition: "color .15s" }}
      onMouseEnter={e => e.currentTarget.style.color = "var(--danger)"}
      onMouseLeave={e => e.currentTarget.style.color = "var(--text3)"}
    >⏻</button>
  );
}
