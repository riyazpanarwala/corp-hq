// src/app/(admin)/admin/attendance/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Badge, Btn, SectionHeader, Skeleton, Avatar, Modal, Field, ToastStack, useToast } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus, downloadCSV, empColor, empInitials, todayStr } from "@/lib/utils";

const defaultTimeForm = (date) => ({
  userId: "",
  date,
  checkInTime: "09:30",
  checkOutTime: "18:30",
  timezone: "Asia/Calcutta",
  notes: "",
});

export default function AdminAttendancePage() {
  const { authFetch, socketOn } = useAuthContext();
  const [records, setRecords] = useState([]);
  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTimeForm, setShowTimeForm] = useState(false);
  const [timeForm, setTimeForm] = useState(() => defaultTimeForm(todayStr()));
  const [timeError, setTimeError] = useState("");
  const [savingTime, setSavingTime] = useState(false);
  const { toasts, toast, remove } = useToast();
  const [filters, setFilters] = useState({
    date:   todayStr(),
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
    if (filters.date)             p.set("date",   filters.date);
    if (filters.userId !== "all") p.set("userId", filters.userId);
    if (filters.status !== "all") p.set("status", filters.status);
    p.set("page",  String(filters.page));
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
    const rows    = records.map(r => [
      r.date, r.user?.name, r.user?.department,
      formatTime(r.checkIn, r.checkInTz), formatTime(r.checkOut, r.checkOutTz || r.checkInTz),
      formatHours(r.hoursWorked),
      r.isLate ? "Late" : r.isHalfDay ? "Half Day" : "Present",
      r.lateMinutes || 0,
    ]);
    downloadCSV([headers, ...rows], `attendance-${filters.date || "all"}.csv`);
  };

  const set = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }));
  const setTimeField = (key, val) => {
    setTimeForm(f => {
      const next = { ...f, [key]: val };
      if (key === "userId") {
        const selected = users.find(u => String(u.id) === String(val));
        if (selected?.timezone) next.timezone = selected.timezone;
      }
      return next;
    });
    if (timeError) setTimeError("");
  };

  const openTimeForm = () => {
    setTimeForm(defaultTimeForm(filters.date || todayStr()));
    setTimeError("");
    setShowTimeForm(true);
  };

  const saveTimeDetails = async (e) => {
    e.preventDefault();
    setTimeError("");

    if (!timeForm.userId || !timeForm.date || !timeForm.checkInTime) {
      setTimeError("Employee, date, and check-in time are required.");
      return;
    }

    setSavingTime(true);
    try {
      const res = await authFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(timeForm),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Could not save time details.");
      }

      await fetchRecords();
      toast("Time details saved.", "success");
      setShowTimeForm(false);
    } catch (err) {
      setTimeError(err.message || "Could not save time details.");
    } finally {
      setSavingTime(false);
    }
  };

  const cols = [
    {
      key: "user", label: "Employee",
      render: r => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar initials={empInitials(r.user?.name)} size={28} color={empColor(r.user?.name, r.user?.id)} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.user?.name}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{r.user?.department}</div>
          </div>
        </div>
      ),
    },
    { key: "date",     label: "Date",      render: r => formatDate(r.date) },
    { key: "checkIn",  label: "Check In",  render: r => formatTime(r.checkIn, r.checkInTz) },
    { key: "checkOut", label: "Check Out", render: r => formatTime(r.checkOut, r.checkOutTz || r.checkInTz) },
    { key: "hours",    label: "Hours",     render: r => formatHours(r.hoursWorked) },
    { key: "late",     label: "Late By",   render: r => r.isLate ? <span style={{color:"var(--warning)"}}>+{r.lateMinutes}m</span> : "-" },
    { key: "status",   label: "Status",    render: r => <Badge status={resolveAttStatus(r)} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader
        title="Attendance Records"
        subtitle={`${total} records`}
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={openTimeForm} size="sm">+ Add Time</Btn>
            <Btn onClick={handleExport} variant="secondary" size="sm">Export CSV</Btn>
          </div>
        }
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

      {showTimeForm && (
        <Modal title="Add Employee Time" onClose={() => !savingTime && setShowTimeForm(false)} width={560}>
          <form onSubmit={saveTimeDetails} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <Field label="Employee">
                <select value={timeForm.userId} onChange={e => setTimeField("userId", e.target.value)}>
                  <option value="">Select employee</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" value={timeForm.date} onChange={e => setTimeField("date", e.target.value)} />
              </Field>
              <Field label="Check in">
                <input type="time" value={timeForm.checkInTime} onChange={e => setTimeField("checkInTime", e.target.value)} />
              </Field>
              <Field label="Check out">
                <input type="time" value={timeForm.checkOutTime} onChange={e => setTimeField("checkOutTime", e.target.value)} />
              </Field>
              <Field label="Timezone">
                <input value={timeForm.timezone} onChange={e => setTimeField("timezone", e.target.value)} />
              </Field>
            </div>

            <Field label="Notes">
              <textarea rows={3} value={timeForm.notes} onChange={e => setTimeField("notes", e.target.value)} placeholder="Reason or correction note" style={{ resize: "vertical" }} />
            </Field>

            {timeError && (
              <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {timeError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn variant="ghost" onClick={() => setShowTimeForm(false)} disabled={savingTime}>Cancel</Btn>
              <Btn type="submit" loading={savingTime}>Save Time</Btn>
            </div>
          </form>
        </Modal>
      )}

      <ToastStack toasts={toasts} remove={remove} />
    </div>
  );
}
