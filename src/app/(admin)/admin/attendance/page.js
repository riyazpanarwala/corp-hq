// src/app/(admin)/admin/attendance/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Badge, Btn, SectionHeader, Skeleton, Avatar, Modal, Field, ToastStack, useToast } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus, downloadCSV, empColor, empInitials, todayStr } from "@/lib/utils";

const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const defaultTimeForm = (date) => ({
  userId: "",
  date,
  checkInTime: "09:30",
  checkOutTime: "18:30",
  timezone: defaultTimezone(),
  notes: "",
});

// Convert a UTC ISO datetime string to a local HH:mm time string in a given timezone.
// e.g. "2026-06-01T04:30:00.000Z" + "Asia/Kolkata" → "10:00"
function isoToLocalTime(iso, timeZone) {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
    // hour12:false can return "24" for midnight — normalise to "00"
    const h = v.hour === "24" ? "00" : v.hour;
    return `${h}:${v.minute}`;
  } catch {
    return "";
  }
}

// Build a pre-populated form from an existing attendance record for editing.
function recordToForm(record) {
  const tz = record.checkInTz || defaultTimezone();
  return {
    userId:       String(record.userId),
    date:         String(record.date).split("T")[0],
    checkInTime:  isoToLocalTime(record.checkIn, tz),
    checkOutTime: record.checkOut ? isoToLocalTime(record.checkOut, tz) : "",
    timezone:     tz,
    notes:        record.notes || "",
  };
}

export default function AdminAttendancePage() {
  const { authFetch, socketOn } = useAuthContext();
  const [records, setRecords] = useState([]);
  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);

  // null  → modal closed
  // false → adding new entry
  // object → editing existing record
  const [editingRecord, setEditingRecord] = useState(null);
  const [showTimeForm,  setShowTimeForm]  = useState(false);

  const [timeForm,  setTimeForm]  = useState(() => defaultTimeForm(todayStr()));
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
      // When the employee is changed in "add" mode, auto-fill their timezone.
      // In "edit" mode we keep the timezone from the original record.
      if (key === "userId" && !editingRecord) {
        const selected = users.find(u => String(u.id) === String(val));
        if (selected?.timezone) next.timezone = selected.timezone;
      }
      return next;
    });
    if (timeError) setTimeError("");
  };

  // Open modal for a brand-new entry.
  const openAddForm = () => {
    setEditingRecord(false);
    setTimeForm(defaultTimeForm(filters.date || todayStr()));
    setTimeError("");
    setShowTimeForm(true);
  };

  // Open modal pre-filled with an existing record's data.
  const openEditForm = (record) => {
    setEditingRecord(record);
    setTimeForm(recordToForm(record));
    setTimeError("");
    setShowTimeForm(true);
  };

  const closeTimeForm = () => {
    if (savingTime) return;
    setShowTimeForm(false);
    setEditingRecord(null);
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
      toast(editingRecord ? "Attendance entry updated." : "Time details saved.", "success");
      setShowTimeForm(false);
      setEditingRecord(null);
    } catch (err) {
      setTimeError(err.message || "Could not save time details.");
    } finally {
      setSavingTime(false);
    }
  };

  const isEditing = !!editingRecord;

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
    {
      key: "edit", label: "",
      render: r => (
        <Btn
          size="xs"
          variant="ghost"
          onClick={() => openEditForm(r)}
          title="Edit this attendance entry"
        >
          ✏️ Edit
        </Btn>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader
        title="Attendance Records"
        subtitle={`${total} records`}
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={openAddForm} size="sm">+ Add Time</Btn>
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
        <Modal
          title={isEditing ? `Edit Attendance — ${editingRecord.user?.name}` : "Add Employee Time"}
          onClose={closeTimeForm}
          width={560}
        >
          <form onSubmit={saveTimeDetails} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* When editing, show a read-only summary instead of the employee/date dropdowns
                since those are the record's identity keys and cannot be changed. */}
            {isEditing ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px",
                background: "var(--surface2)",
                borderRadius: "var(--radius-sm)",
                fontSize: 13,
              }}>
                <Avatar
                  initials={empInitials(editingRecord.user?.name)}
                  size={34}
                  color={empColor(editingRecord.user?.name, editingRecord.user?.id)}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{editingRecord.user?.name}</div>
                  <div style={{ color: "var(--text3)", fontSize: 12 }}>
                    {editingRecord.user?.department} · {formatDate(editingRecord.date)}
                  </div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text3)" }}>
                  Timezone: {timeForm.timezone}
                </div>
              </div>
            ) : (
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
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Check In">
                <input type="time" value={timeForm.checkInTime} onChange={e => setTimeField("checkInTime", e.target.value)} />
              </Field>
              <Field label="Check Out" hint="Leave blank if still checked in">
                <input type="time" value={timeForm.checkOutTime} onChange={e => setTimeField("checkOutTime", e.target.value)} />
              </Field>
            </div>

            {/* Only show timezone override in add mode; in edit mode it's read-only above */}
            {!isEditing && (
              <Field label="Timezone">
                <input value={timeForm.timezone} onChange={e => setTimeField("timezone", e.target.value)} />
              </Field>
            )}

            <Field label="Notes">
              <textarea
                rows={3}
                value={timeForm.notes}
                onChange={e => setTimeField("notes", e.target.value)}
                placeholder="Reason or correction note"
                style={{ resize: "vertical" }}
              />
            </Field>

            {timeError && (
              <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {timeError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn variant="ghost" onClick={closeTimeForm} disabled={savingTime}>Cancel</Btn>
              <Btn type="submit" loading={savingTime}>
                {isEditing ? "Update Entry" : "Save Time"}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      <ToastStack toasts={toasts} remove={remove} />
    </div>
  );
}
