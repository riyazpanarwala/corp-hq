// src/components/layout/Sidebar.js
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui";
import { useAuthContext } from "@/components/providers/AuthProvider";

const ADMIN_NAV = [
  { href: "/admin/dashboard",  icon: "⚡", label: "Dashboard"      },
  { href: "/admin/attendance", icon: "📋", label: "Attendance"     },
  { href: "/admin/leaves",     icon: "🗓️", label: "Leave Requests" },
  { href: "/admin/employees",  icon: "👥", label: "Employees"      },
  { href: "/admin/reports",    icon: "📊", label: "Reports"        },
];

const EMPLOYEE_NAV = [
  { href: "/employee/dashboard",  icon: "⚡", label: "Dashboard"  },
  { href: "/employee/attendance", icon: "🕐", label: "Attendance" },
  { href: "/employee/leaves",     icon: "🗓️", label: "My Leaves"  },
];

const COLORS = ["#4f8ef7","#7c5cfc","#22d3a5","#f5a623","#f04444"];

export function Sidebar() {
  const { user, logout, isAdmin } = useAuthContext();
  const pathname  = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) return null;

  const nav      = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;
  const initials = user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color    = COLORS[user.id % COLORS.length];
  const W        = collapsed ? 64 : 220;

  return (
    <aside style={{
      width: W, minHeight: "100vh",
      background: "var(--surface)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      position: "sticky", top: 0, flexShrink: 0, zIndex: 100,
      transition: "width .25s cubic-bezier(.4,0,.2,1)",
    }}>
      <div style={{
        padding: collapsed ? "18px 0" : "18px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        minHeight: 64,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg,var(--accent),var(--accent2))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, boxShadow: "var(--shadow-accent)",
          }}>🏢</div>
          {!collapsed && (
            <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 17, whiteSpace: "nowrap" }}>
              CorpHQ
            </span>
          )}
        </div>
        {!collapsed && <CollapseBtn icon="◀" onClick={() => setCollapsed(true)} />}
      </div>

      {collapsed && (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
          <CollapseBtn icon="▶" onClick={() => setCollapsed(false)} />
        </div>
      )}

      {!collapsed && (
        <div style={{ padding: "10px 16px 4px" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
            color: isAdmin ? "var(--accent)" : "var(--success)",
            background: isAdmin ? "var(--accent-glow)" : "rgba(34,211,165,.1)",
            padding: "3px 8px", borderRadius: 6,
          }}>
            {isAdmin ? "Admin · HR" : user.department}
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
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: collapsed ? "10px" : "10px 12px",
                borderRadius: "var(--radius-sm)", textDecoration: "none",
                background: active ? "var(--accent-glow)" : "transparent",
                color:      active ? "var(--accent)" : "var(--text2)",
                fontWeight: active ? 600 : 400, fontSize: 14,
                justifyContent: collapsed ? "center" : "flex-start",
                borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                transition: "all .15s",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--surface2)"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
        {collapsed ? (
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
