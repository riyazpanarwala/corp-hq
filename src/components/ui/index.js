// src/components/ui/index.js
"use client";
import { useState, useEffect, useCallback } from "react";
import { empColor, empInitials } from "@/lib/utils";

// ─── Avatar ───────────────────────────────────────────────────
export function Avatar({ initials, size = 36, color = "var(--accent)" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `${color}1a`, border: `2px solid ${color}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color,
      fontFamily: "Syne, sans-serif", userSelect: "none",
    }}>
      {initials}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────
const BADGE_MAP = {
  present:       { color: "#22d3a5", label: "Present"     },
  absent:        { color: "#f04444", label: "Absent"      },
  late:          { color: "#f5a623", label: "Late"        },
  halfday:       { color: "#4f8ef7", label: "Half Day"    },
  "half-day":    { color: "#4f8ef7", label: "Half Day"    },
  checkedin:     { color: "#38bdf8", label: "In Office"   },
  "checked-out": { color: "#8892a4", label: "Checked Out" },
  pending:       { color: "#f5a623", label: "Pending"     },
  approved:      { color: "#22d3a5", label: "Approved"    },
  rejected:      { color: "#f04444", label: "Rejected"    },
  cancelled:     { color: "#5a6478", label: "Cancelled"   },
  admin:         { color: "#4f8ef7", label: "Admin"       },
  employee:      { color: "#22d3a5", label: "Employee"    },
};

export function Badge({ status }) {
  const s = BADGE_MAP[String(status).toLowerCase()] || { color: "#5a6478", label: status };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
      color: s.color, background: `${s.color}14`, border: `1px solid ${s.color}30`,
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────
export function Card({ children, style = {}, className = "" }) {
  return (
    <div className={`fade-up ${className}`} style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: 24, ...style,
    }}>
      {children}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────
export function StatCard({ icon, label, value, sub, color = "var(--accent)", trend }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "var(--radius-md)",
          background: `${color}16`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 20,
        }}>{icon}</div>
        {trend !== undefined && (
          <span style={{ fontSize: 12, fontWeight: 600, color: trend >= 0 ? "var(--success)" : "var(--danger)" }}>
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "Syne, sans-serif", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 3 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>{sub}</div>}
      </div>
    </Card>
  );
}

// ─── Button ───────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary:   { background: "var(--accent)",   color: "#fff",         border: "none" },
  secondary: { background: "var(--surface2)", color: "var(--text)",  border: "1px solid var(--border)" },
  success:   { background: "var(--success)",  color: "#061a12",      border: "none" },
  danger:    { background: "var(--danger)",   color: "#fff",         border: "none" },
  warning:   { background: "var(--warning)",  color: "#1a0e00",      border: "none" },
  ghost:     { background: "transparent",     color: "var(--text2)", border: "1px solid var(--border)" },
};

const BTN_SIZES = {
  xs: { padding: "4px 10px",  fontSize: 11, borderRadius: 7  },
  sm: { padding: "6px 14px",  fontSize: 13, borderRadius: 9  },
  md: { padding: "10px 20px", fontSize: 14, borderRadius: 10 },
  lg: { padding: "13px 28px", fontSize: 15, borderRadius: 12 },
};

export function Btn({ children, onClick, variant = "primary", size = "md", disabled, loading, style = {}, title, type = "button" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      style={{
        ...BTN_VARIANTS[variant], ...BTN_SIZES[size],
        fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
        opacity: (disabled || loading) ? 0.45 : 1,
        cursor:  (disabled || loading) ? "not-allowed" : "pointer",
        transition: "opacity .15s, transform .15s", ...style,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.82"; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = "1"; }}
      onMouseDown={e  => { if (!disabled) e.currentTarget.style.transform = "scale(.97)"; }}
      onMouseUp={e    => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

// ─── Spinner ──────────────────────────────────────────────────
export function Spinner({ size = 18, color = "currentColor" }) {
  return (
    <span className="spin" style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color}30`, borderTopColor: color,
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

// ─── Modal ────────────────────────────────────────────────────
export function Modal({ title, children, onClose, width = 520 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,.72)", backdropFilter: "blur(5px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div className="scale-in" style={{
        background: "var(--surface)", border: "1px solid var(--border2)",
        borderRadius: "var(--radius-xl)", padding: 28,
        width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto",
        boxShadow: "var(--shadow-md)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "var(--surface2)", border: "1px solid var(--border)",
            color: "var(--text2)", width: 32, height: 32, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────
export function Table({ cols, rows, emptyMsg = "No records found." }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {cols.map(c => (
              <th key={c.key} style={{
                padding: "9px 14px", textAlign: "left",
                color: "var(--text3)", fontSize: 11, fontWeight: 700,
                letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap",
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
                {emptyMsg}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr key={i}
              style={{ borderBottom: "1px solid var(--border)", transition: "background .15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              {cols.map(c => (
                <td key={c.key} style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                  {c.render ? c.render(row) : (row[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2, flexWrap: "wrap",
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)", padding: 4, width: "fit-content",
    }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          padding: "7px 16px", borderRadius: 9, border: "none", cursor: "pointer",
          background: active === tab.id ? "var(--accent)" : "transparent",
          color:      active === tab.id ? "#fff" : "var(--text2)",
          fontSize: 13, fontWeight: 600, transition: "all .15s",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {tab.label}
          {tab.count !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "1px 7px",
              background: active === tab.id ? "rgba(255,255,255,.22)" : "var(--surface2)",
            }}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{title}</h1>
        {subtitle && <p style={{ color: "var(--text2)", fontSize: 14, marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ─── ToastStack ───────────────────────────────────────────────
export function ToastStack({ toasts, remove }) {
  const S = {
    success: { border: "var(--success)", bg: "rgba(34,211,165,.1)",  icon: "✅" },
    error:   { border: "var(--danger)",  bg: "rgba(240,68,68,.1)",   icon: "❌" },
    warning: { border: "var(--warning)", bg: "rgba(245,166,35,.1)",  icon: "⚠️" },
    info:    { border: "var(--border2)", bg: "var(--surface2)",      icon: "ℹ️" },
  };
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none" }}>
      {toasts.map(t => {
        const s = S[t.type] || S.info;
        return (
          <div key={t.id} className="fade-up" style={{
            background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: "var(--radius-md)", padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 10,
            color: "var(--text)", fontSize: 14, fontWeight: 500,
            minWidth: 260, maxWidth: 380, boxShadow: "var(--shadow-md)",
            backdropFilter: "blur(10px)", pointerEvents: "all",
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button onClick={() => remove(t.id)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 15 }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── useToast ─────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast  = useCallback((message, type = "info") => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);
  const remove = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);
  return { toasts, toast, remove };
}

// ─── LiveClock ────────────────────────────────────────────────
export function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ fontFamily: "Syne, sans-serif" }}>
      <span style={{ fontSize: 14, color: "var(--text2)" }}>
        {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text3)" }}>
        {time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

// ─── ProgressBar ──────────────────────────────────────────────
export function ProgressBar({ value, max, color = "var(--accent)", height = 6 }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, background: "var(--surface2)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999, transition: "width .5s ease" }} />
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────
export function Field({ label, children, hint, error }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500 }}>{label}</label>
      {children}
      {hint  && !error && <span style={{ fontSize: 11, color: "var(--text3)" }}>{hint}</span>}
      {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>⚠ {error}</span>}
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────
export function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      {label && <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────
export function Skeleton({ width = "100%", height = 20, borderRadius = 8 }) {
  return <div className="shimmer" style={{ width, height, borderRadius }} />;
}

// ─── EmpCell ──────────────────────────────────────────────────
// Uses shared empColor/empInitials from utils — no more local duplication.
export function EmpCell({ emp, sub }) {
  if (!emp) return <span style={{ color: "var(--text3)" }}>—</span>;
  const color    = empColor(emp.name, emp.id);
  const initials = empInitials(emp.name);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Avatar initials={initials} size={28} color={color} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text3)" }}>{sub}</div>}
      </div>
    </div>
  );
}
