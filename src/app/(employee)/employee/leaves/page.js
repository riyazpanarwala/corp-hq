// src/app/(employee)/employee/leaves/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Badge, Btn, Modal, SectionHeader, ProgressBar, Field, Skeleton } from "@/components/ui";
import { formatDate, countWorkingDays, availableDays, LEAVE_CONFIG } from "@/lib/utils";

export default function EmployeeLeavesPage() {
  const { authFetch, socketOn } = useAuthContext();
  const [leaves,  setLeaves]  = useState([]);
  const [balance, setBalance] = useState(null);
  const [modal,   setModal]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [lvRes, balRes] = await Promise.all([
      authFetch("/api/leaves?limit=50"),
      authFetch("/api/leaves/balance"),
    ]);
    const [lv, bal] = await Promise.all([lvRes.json(), balRes.json()]);
    setLeaves(lv.leaves || []);
    setBalance(bal.balance);
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const off = socketOn("leave:reviewed", () => { fetchAll(); });
    return off;
  }, [socketOn, fetchAll]);

  const handleApply = async (data) => {
    const res  = await authFetch("/api/leaves", { method: "POST", body: JSON.stringify(data) });
    const json = await res.json();
    if (res.ok) {
      setModal(false);
      fetchAll();
      showToast("Leave request submitted successfully!", "success");
      return { success: true };
    }
    return { success: false, error: json.error || "Failed to apply" };
  };

  const handleCancel = async (id) => {
    const res = await authFetch(`/api/leaves/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchAll();
      showToast("Leave request cancelled.", "info");
    }
  };

  const avail = (key) => availableDays(balance, key);

  const cols = [
    { key: "type",   label: "Type",    render: r => `${LEAVE_CONFIG[r.type]?.emoji||""} ${LEAVE_CONFIG[r.type]?.label||r.type}` },
    { key: "from",   label: "From",    render: r => formatDate(r.startDate) },
    { key: "to",     label: "To",      render: r => formatDate(r.endDate) },
    { key: "days",   label: "Days" },
    { key: "reason", label: "Reason",  render: r => <span className="truncate" style={{color:"var(--text2)",maxWidth:160,display:"block"}}>{r.reason}</span> },
    { key: "status", label: "Status",  render: r => <Badge status={r.status?.toLowerCase()} /> },
    { key: "note",   label: "HR Note", render: r => r.reviewNote ? <span style={{fontSize:12,color:"var(--text3)"}}>{r.reviewNote}</span> : "—" },
    { key: "action", label: "",        render: r => r.status === "PENDING"
      ? <Btn size="xs" variant="ghost" onClick={() => handleCancel(r.id)}>Cancel</Btn>
      : null
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "rgba(34,211,165,.15)" : "var(--surface2)",
          border: `1px solid ${toast.type === "success" ? "var(--success)" : "var(--border2)"}`,
          borderRadius: "var(--radius-md)", padding: "12px 18px",
          color: "var(--text)", fontSize: 14, fontWeight: 500, minWidth: 260,
        }} className="fade-up">{toast.msg}</div>
      )}

      <SectionHeader
        title="My Leaves"
        subtitle="Manage your leave requests and balance"
        action={<Btn onClick={() => setModal(true)}>+ Apply Leave</Btn>}
      />

      {/* Balance cards */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          {[...Array(3)].map((_,i) => <Skeleton key={i} height={140} />)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          {Object.entries(LEAVE_CONFIG).map(([key, lt]) => {
            const total   = balance?.[`${key.toLowerCase()}Total`]   || 0;
            const used    = balance?.[`${key.toLowerCase()}Used`]    || 0;
            const pending = balance?.[`${key.toLowerCase()}Pending`] || 0;
            const a       = avail(key);
            return (
              <Card key={key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>{lt.label}</div>
                    <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "Syne, sans-serif", color: lt.color }}>{a}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>of {total} available</div>
                  </div>
                  <span style={{ fontSize: 26 }}>{lt.emoji}</span>
                </div>
                <ProgressBar value={used + pending} max={total} color={lt.color} height={5} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--text3)" }}>
                  <span>{used} used</span>
                  {pending > 0 && <span style={{ color: "var(--warning)" }}>{pending} pending</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        {loading ? <Skeleton height={250} /> : (
          <Table cols={cols} rows={leaves} emptyMsg="No leave requests yet. Apply for your first leave!" />
        )}
      </Card>

      {modal && (
        <ApplyLeaveModal
          balance={balance}
          onClose={() => setModal(false)}
          onSubmit={handleApply}
        />
      )}
    </div>
  );
}

// ── Apply Leave Modal ─────────────────────────────────────────
function ApplyLeaveModal({ balance, onClose, onSubmit }) {
  const today = new Date().toISOString().split("T")[0];
  const [form,    setForm]    = useState({ type: "CL", startDate: today, endDate: today, reason: "" });
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const days  = countWorkingDays(form.startDate, form.endDate);
  const avail = availableDays(balance, form.type);

  const handleSubmit = async () => {
    setError("");
    if (!form.reason.trim() || form.reason.length < 5) { setError("Reason must be at least 5 characters."); return; }
    if (days <= 0)   { setError("End date must be on or after start date."); return; }
    if (days > avail) { setError(`Only ${avail} day${avail!==1?"s":""} available for ${form.type}.`); return; }
    setLoading(true);
    const result = await onSubmit(form);
    if (!result.success) setError(result.error || "Failed to submit");
    setLoading(false);
  };

  const b = balance ? {
    total:   balance[`${form.type.toLowerCase()}Total`]   || 0,
    pending: balance[`${form.type.toLowerCase()}Pending`] || 0,
  } : { total: 0, pending: 0 };

  return (
    <Modal title="Apply for Leave" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Leave Type">
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {Object.entries(LEAVE_CONFIG).map(([k, lt]) => (
              <option key={k} value={k}>{lt.emoji} {lt.label} ({k})</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
            Balance: <strong style={{ color: avail > 0 ? "var(--success)" : "var(--danger)" }}>{avail} days</strong> available
            {b.pending > 0 && ` · ${b.pending} pending`}
          </span>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Start Date">
            <input type="date" value={form.startDate} min={today}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate }))} />
          </Field>
          <Field label="End Date">
            <input type="date" value={form.endDate} min={form.startDate}
              onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
          </Field>
        </div>

        {days > 0 && (
          <div style={{ padding: "10px 14px", background: "var(--accent-glow)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
            📅 <strong>{days}</strong> working day{days !== 1 ? "s" : ""} selected
            {days > avail && <span style={{ color: "var(--danger)", marginLeft: 8 }}>⚠️ Exceeds balance</span>}
          </div>
        )}

        <Field label="Reason">
          <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            rows={3} placeholder="Briefly describe the reason for your leave…" style={{ resize: "vertical" }} />
        </Field>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(240,68,68,.1)", borderRadius: "var(--radius-sm)" }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
          <Btn onClick={handleSubmit} loading={loading} style={{ flex: 1, justifyContent: "center" }}>Submit Request</Btn>
        </div>
      </div>
    </Modal>
  );
}
