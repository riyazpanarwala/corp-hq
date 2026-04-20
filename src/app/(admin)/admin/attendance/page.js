// src/app/(admin)/admin/attendance/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Badge, Btn, SectionHeader, Skeleton } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus, downloadCSV } from "@/lib/utils";

export default function AdminAttendancePage() {
  const { authFetch, socketOn } = useAuthContext();
  const [records,  setRecords]  = useState([]);
  const [users,    setUsers]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [filters,  setFilters]  = useState({
    date:   new Date().toISOString().split("T")[0],
    userId: "all",
    status: "all",
    page:   1,
  });

  const fetchUsers = useCallback(async () => {
    const res  = await authFetch("/api/users");
    const data = await res.json();
    setUsers((data.users || []).filter(u => u.role === "EMPLOYEE"));
  }, [authFetch]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filters.date)            p.set("date",   filters.date);
    if (filters.userId !== "all") p.set("userId", filters.userId);
    if (filters.status !== "all") p.set("status", filters.status);
    p.set("page", String(filters.page));
    p.set("limit", "50");
    const res  = await authFetch(`/api/attendance?${p}`);
    const data = await res.json();
    setRecords(data.records || []);
    setTotal(data.pagination?.total || 0);
    setLoading(false);
  }, [filters, authFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    const off1 = socketOn("attendance:checkin",  fetchRecords);
    const off2 = socketOn("attendance:checkout", fetchRecords);
    return () => { off1(); off2(); };
  }, [socketOn, fetchRecords]);

  const handleExport = () => {
    const headers = ["Date","Employee","Department","Check In","Check Out","Hours","Status","Late (min)"];
    const rows = records.map(r => [
      r.date, r.user?.name, r.user?.department,
      formatTime(r.checkIn), formatTime(r.checkOut),
      formatHours(r.hoursWorked),
      r.isLate ? "Late" : r.isHalfDay ? "Half Day" : "Present",
      r.lateMinutes || 0,
    ]);
    downloadCSV([headers, ...rows], `attendance-${filters.date || "all"}.csv`);
  };

  const set = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }));

  const cols = [
    { key: "user",     label: "Employee",  render: r => <div style={{ display:"flex",alignItems:"center",gap:8 }}><Initials name={r.user?.name} id={r.user?.id} /><div><div style={{fontWeight:600,fontSize:13}}>{r.user?.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{r.user?.department}</div></div></div> },
    { key: "date",     label: "Date",      render: r => formatDate(r.date) },
    { key: "checkIn",  label: "Check In",  render: r => formatTime(r.checkIn) },
    { key: "checkOut", label: "Check Out", render: r => formatTime(r.checkOut) },
    { key: "hours",    label: "Hours",     render: r => formatHours(r.hoursWorked) },
    { key: "late",     label: "Late By",   render: r => r.isLate ? <span style={{color:"var(--warning)"}}>+{r.lateMinutes}m</span> : "—" },
    { key: "status",   label: "Status",    render: r => <Badge status={resolveAttStatus(r)} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader
        title="Attendance Records"
        subtitle={`${total} records`}
        action={<Btn onClick={handleExport} variant="secondary" size="sm">📥 Export CSV</Btn>}
      />

      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" value={filters.date} onChange={e => set("date", e.target.value)} style={{ width: "auto", flex: "1 1 140px" }} />
          <select value={filters.userId} onChange={e => set("userId", e.target.value)} style={{ flex: "1 1 160px" }}>
            <option value="all">All Employees</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={filters.status} onChange={e => set("status", e.target.value)} style={{ flex: "1 1 130px" }}>
            <option value="all">All Status</option>
            <option value="late">Late Only</option>
            <option value="halfday">Half Day</option>
          </select>
          <Btn variant="ghost" size="sm" onClick={() => setFilters({ date: "", userId: "all", status: "all", page: 1 })}>Clear</Btn>
        </div>
      </Card>

      <Card>
        {loading ? <Skeleton height={300} /> : (
          <Table cols={cols} rows={records} emptyMsg="No records match your filters." />
        )}
      </Card>
    </div>
  );
}

function Initials({ name, id }) {
  const COLORS = ["#4f8ef7","#7c5cfc","#22d3a5","#f5a623","#f04444"];
  const color  = COLORS[(id || 0) % COLORS.length];
  const ini    = (name || "").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase() || "??";
  return (
    <div style={{ width:28,height:28,borderRadius:"50%",flexShrink:0,background:`${color}1a`,border:`2px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color }}>
      {ini}
    </div>
  );
}
