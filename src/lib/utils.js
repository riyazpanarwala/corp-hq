// src/lib/utils.js  — browser-safe, no server imports

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(str) {
  if (!str) return "—";
  const dateStr = String(str).split("T")[0];
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatHours(h) {
  if (h == null || h === "") return "—";
  const n    = parseFloat(h);
  const hrs  = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthStr() {
  return new Date().toISOString().slice(0, 7);
}

function countWorkingDays(startStr, endStr) {
  const start = new Date(startStr);
  const end   = new Date(endStr);
  let count   = 0;
  const d     = new Date(start);
  while (d <= end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function availableDays(balance, type) {
  if (!balance) return 0;
  const k = type.toLowerCase();
  return Math.max(
    0,
    (balance[`${k}Total`]   || 0) -
    (balance[`${k}Used`]    || 0) -
    (balance[`${k}Pending`] || 0),
  );
}

function resolveAttStatus(record) {
  if (!record)           return "absent";
  if (record.isHalfDay)  return "halfday";
  if (record.isLate)     return "late";
  if (!record.checkOut)  return "checkedin";
  return "present";
}

function downloadCSV(rows, filename) {
  const csv  = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EMP_COLORS = ["#4f8ef7", "#7c5cfc", "#22d3a5", "#f5a623", "#f04444"];

function empColor(name, id) {
  if (name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return EMP_COLORS[hash % EMP_COLORS.length];
  }
  return EMP_COLORS[(id || 0) % EMP_COLORS.length];
}

function empInitials(name) {
  return (name || "")
    .split(" ")
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "??";
}

const LEAVE_CONFIG = {
  CL: { label: "Casual Leave", emoji: "🏖️", color: "var(--accent)"  },
  SL: { label: "Sick Leave",   emoji: "🏥", color: "var(--warning)" },
  PL: { label: "Paid Leave",   emoji: "💰", color: "var(--success)" },
};

module.exports = {
  formatTime, formatDate, formatHours, todayStr, monthStr,
  countWorkingDays, availableDays, resolveAttStatus, downloadCSV,
  empColor, empInitials,
  LEAVE_CONFIG,
};
