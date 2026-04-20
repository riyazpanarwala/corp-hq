// src/app/(employee)/employee/attendance/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, StatCard, Badge, Table, SectionHeader, LiveClock, Btn, Skeleton } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus } from "@/lib/utils";

export default function EmployeeAttendancePage() {
  const { authFetch } = useAuthContext();
  const [records,  setRecords]  = useState([]);
  const [todayRec, setTodayRec] = useState(null);
  const [elapsed,  setElapsed]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState(false);
  const [month,    setMonth]    = useState(new Date().toISOString().slice(0,7));

  const fetchRecords = useCallback(async () => {
    const [monthRes, todayRes] = await Promise.all([
      authFetch(`/api/attendance?month=${month}&limit=60`),
      authFetch("/api/attendance/today"),
    ]);
    const [monthData, todayData] = await Promise.all([monthRes.json(), todayRes.json()]);
    setRecords(monthData.records || []);
    setTodayRec(todayData.record || null);
    setLoading(false);
  }, [authFetch, month]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    if (!todayRec?.checkIn || todayRec?.checkOut) { setElapsed(null); return; }
    const tick = () => setElapsed((Date.now() - new Date(todayRec.checkIn).getTime()) / 3_600_000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [todayRec]);

  const handleCheckIn = async () => {
    setChecking(true);
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await authFetch("/api/attendance", { method: "POST", body: JSON.stringify({ timezone: tz }) });
    if (res.ok) fetchRecords();
    setChecking(false);
  };

  const handleCheckOut = async () => {
    setChecking(true);
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await authFetch("/api/attendance/checkout", { method: "PATCH", body: JSON.stringify({ timezone: tz }) });
    if (res.ok) fetchRecords();
    setChecking(false);
  };

  const isIn   = todayRec && !todayRec.checkOut;
  const isDone = todayRec && !!todayRec.checkOut;
  const totalH = records.reduce((s, r) => s + (Number(r.hoursWorked)||0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader
        title="My Attendance"
        subtitle="Check-in history and monthly stats"
        action={<input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: "auto" }} />}
      />

      {/* Check-in widget (compact) */}
      <Card style={{ background: "linear-gradient(135deg,rgba(79,142,247,.06),rgba(124,92,252,.06))", border: "1px solid rgba(79,142,247,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: 18, fontWeight: 800 }}>
            {isDone ? "✅ Completed" : isIn ? "🟢 In Office" : "⚪ Not Checked In"}
          </div>
          <LiveClock />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Check In",    value: formatTime(todayRec?.checkIn) },
            { label: "Check Out",   value: formatTime(todayRec?.checkOut) },
            { label: "Hours",       value: isIn && elapsed ? formatHours(elapsed) : formatHours(todayRec?.hoursWorked) },
          ].map(c => (
            <div key={c.label} style={{ background: "var(--surface2)", borderRadius: "var(--radius-sm)", padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
        {!todayRec && <Btn onClick={handleCheckIn} loading={checking} variant="success" size="md" style={{ width: "100%", justifyContent: "center" }}>✅ Check In</Btn>}
        {isIn      && <Btn onClick={handleCheckOut} loading={checking} variant="danger" size="md" style={{ width: "100%", justifyContent: "center" }}>🚪 Check Out</Btn>}
      </Card>

      {/* Month stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14 }}>
        <StatCard icon="✅" label="On Time"    value={records.filter(r=>!r.isLate&&!r.isHalfDay).length} color="var(--success)" />
        <StatCard icon="⚠️" label="Late"       value={records.filter(r=>r.isLate).length}                color="var(--warning)" />
        <StatCard icon="🌓" label="Half Days"  value={records.filter(r=>r.isHalfDay).length}             color="var(--accent)"  />
        <StatCard icon="⏱️" label="Total Hours" value={formatHours(totalH)}                              color="var(--accent2)" />
      </div>

      <Card>
        {loading ? <Skeleton height={300} /> : (
          <Table
            cols={[
              { key: "date",     label: "Date",      render: r => formatDate(r.date) },
              { key: "checkIn",  label: "Check In",  render: r => formatTime(r.checkIn) },
              { key: "checkOut", label: "Check Out", render: r => formatTime(r.checkOut) },
              { key: "hours",    label: "Hours",     render: r => formatHours(r.hoursWorked) },
              { key: "late",     label: "Late By",   render: r => r.isLate ? <span style={{color:"var(--warning)"}}>+{r.lateMinutes}m</span> : "—" },
              { key: "status",   label: "Status",    render: r => <Badge status={resolveAttStatus(r)} /> },
            ]}
            rows={[...records].sort((a,b) => b.date.localeCompare(a.date))}
            emptyMsg="No attendance records for this month."
          />
        )}
      </Card>
    </div>
  );
}
