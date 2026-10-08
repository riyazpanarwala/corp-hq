// src/app/(employee)/employee/attendance/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, StatCard, Badge, Table, SectionHeader, LiveClock, Btn, Skeleton, Modal, Field } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus, todayStr } from "@/lib/utils";

export default function EmployeeAttendancePage() {
  const { authFetch, socketOn } = useAuthContext();
  const [records, setRecords] = useState([]);
  const [todayRec, setTodayRec] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  // ── Regularization requests ────────────────────────────────────────────
  const [regRequests, setRegRequests] = useState([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm] = useState(() => defaultRegForm());
  const [regError, setRegError] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [workMode, setWorkMode] = useState("WFO");
  const [geoStatus, setGeoStatus] = useState("");

  const getCoordinates = () => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          console.warn("[Geo] Location error:", err.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  };

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // FIX (CodeRabbit #9 — UTC vs local date): previously used
  // new Date().toISOString().split("T")[0], which is always UTC and can be
  // a day off from the employee's actual local date. Now uses the shared
  // todayStr() util (local Y/M/D components), the same helper already used
  // elsewhere (e.g. admin attendance page's default filter date).
  function defaultRegForm() {
    return {
      date: todayStr(),
      checkInTime: "09:30",
      checkOutTime: "18:30",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      reason: "",
    };
  }

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

  const fetchRegRequests = useCallback(async () => {
    const res = await authFetch("/api/attendance/regularize?limit=20");
    const data = await res.json();
    setRegRequests(data.requests || []);
  }, [authFetch]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchRegRequests(); }, [fetchRegRequests]);

  useEffect(() => {
    const off = socketOn("regularization:reviewed", () => { fetchRegRequests(); fetchRecords(); });
    return off;
  }, [socketOn, fetchRegRequests, fetchRecords]);

  useEffect(() => {
    const active = todayRec?.sessions?.find(s => !s.checkOut) || (todayRec?.checkIn && !todayRec?.checkOut ? todayRec : null);
    if (!active?.checkIn) { setElapsed(null); return; }

    const closedHours = (todayRec.sessions || [])
      .filter(s => s.checkOut && s.id !== active.id)
      .reduce((sum, s) => sum + (parseFloat(s.hoursWorked) || 0), 0);

    const tick = () => {
      const activeHours = (Date.now() - new Date(active.checkIn).getTime()) / 3_600_000;
      setElapsed(closedHours + activeHours);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [todayRec]);

  const handleCheckIn = async () => {
    setChecking(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let coords = null;
    if (workMode === "WFO") {
      setGeoStatus("Detecting GPS...");
      coords = await getCoordinates();
    }
    const payload = {
      timezone: tz,
      workMode,
      ...(coords && { latitude: coords.latitude, longitude: coords.longitude }),
    };
    try {
      const res = await authFetch("/api/attendance", { method: "POST", body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Attendance request failed", "error");
      } else {
        showToast(data.isLate ? "Checked in — marked Late ⚠️" : "Checked in successfully ✅", data.isLate ? "warning" : "success");
        await fetchRecords();
      }
    } catch (error) {
      showToast(error.message || "Attendance request failed", "error");
    } finally {
      setChecking(false);
      setGeoStatus("");
    }
  };

  const handleCheckOut = async () => {
    setChecking(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const res = await authFetch("/api/attendance/checkout", { method: "PATCH", body: JSON.stringify({ timezone: tz }) });
      if (!res.ok) throw new Error("Attendance request failed");
      await fetchRecords();
    } catch (error) {
      console.error(error);
    } finally {
      setChecking(false);
    }
  };

  const setRegField = (key, value) => {
    setRegForm(f => ({ ...f, [key]: value }));
    if (regError) setRegError("");
  };

  const closeRegModal = () => {
    if (regSaving) return;
    setShowRegModal(false);
    setRegForm(defaultRegForm());
    setRegError("");
  };

  const submitRegularization = async (e) => {
    e.preventDefault();
    setRegError("");
    if (!regForm.reason.trim() || regForm.reason.trim().length < 5) {
      setRegError("Reason must be at least 5 characters.");
      return;
    }
    setRegSaving(true);
    try {
      const res = await authFetch("/api/attendance/regularize", {
        method: "POST",
        body: JSON.stringify(regForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not submit request.");
      await fetchRegRequests();
      showToast("Correction request submitted — awaiting admin review.", "success");
      // FIX (CodeRabbit #9 — modal stayed open after success): closeRegModal()
      // is guarded by `if (regSaving) return`, and regSaving is still true
      // here (setRegSaving(false) hasn't run yet). Close and reset directly.
      setShowRegModal(false);
      setRegForm(defaultRegForm());
    } catch (err) {
      setRegError(err.message || "Could not submit request.");
    } finally {
      setRegSaving(false);
    }
  };

  const handleCancelReg = async (id) => {
    setCancellingId(id);
    try {
      const res = await authFetch(`/api/attendance/regularize/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchRegRequests();
        showToast("Request cancelled.", "info");
      } else {
        const json = await res.json();
        showToast(json.error || "Failed to cancel request.", "error");
      }
    } catch (err) {
      showToast(err.message || "Failed to cancel request.", "error");
    } finally {
      setCancellingId(null);
    }
  };

  const activeSession = todayRec?.sessions?.find(s => !s.checkOut) || (todayRec?.checkIn && !todayRec?.checkOut ? todayRec : null);
  const isIn = !!activeSession;
  const isDone = !isIn && !!todayRec?.checkOut;
  const totalH = records.reduce((s, r) => s + (Number(r.hoursWorked) || 0), 0);

  const regCols = [
    { key: "date", label: "Date", render: r => formatDate(r.date) },
    { key: "checkIn", label: "Requested In", render: r => r.requestedCheckIn },
    { key: "checkOut", label: "Requested Out", render: r => r.requestedCheckOut || "—" },
    { key: "reason", label: "Reason", render: r => <span className="truncate" style={{ color: "var(--text2)", maxWidth: 160, display: "block" }}>{r.reason}</span> },
    { key: "status", label: "Status", render: r => <Badge status={r.status?.toLowerCase()} /> },
    {
      key: "action", label: "",
      render: r => r.status === "PENDING"
        ? (
          <Btn size="xs" variant="ghost" loading={cancellingId === r.id} disabled={cancellingId !== null}
            onClick={() => handleCancelReg(r.id)}>
            Cancel
          </Btn>
        )
        : (r.reviewNote ? <span style={{ fontSize: 12, color: "var(--text3)" }}>{r.reviewNote}</span> : null),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "rgba(34,211,165,.15)" : toast.type === "error" ? "rgba(240,68,68,.15)" : "var(--surface2)",
          border: `1px solid ${toast.type === "success" ? "var(--success)" : toast.type === "error" ? "var(--danger)" : "var(--border2)"}`,
          borderRadius: "var(--radius-md)", padding: "12px 18px",
          color: "var(--text)", fontSize: 14, fontWeight: 500, minWidth: 260,
        }} className="fade-up">{toast.msg}</div>
      )}

      <SectionHeader
        title="My Attendance"
        subtitle="Check-in history and monthly stats"
        action={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: "auto" }} />
            <Btn variant="secondary" size="sm" onClick={() => setShowRegModal(true)}>🛠 Request Correction</Btn>
          </div>
        }
      />

      <Card style={{ background: "linear-gradient(135deg,rgba(79,142,247,.06),rgba(124,92,252,.06))", border: "1px solid rgba(79,142,247,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: 18, fontWeight: 800 }}>
            {isIn ? "🟢 In Office" : isDone ? "✅ Checked Out" : "⚪ Not Checked In"}
          </div>
          <LiveClock />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Check In", value: formatTime(todayRec?.checkIn, todayRec?.checkInTz) },
            { label: "Check Out", value: formatTime(todayRec?.checkOut, todayRec?.checkOutTz || todayRec?.checkInTz) },
            { label: "Hours", value: isIn && elapsed ? formatHours(elapsed) : formatHours(todayRec?.hoursWorked) },
          ].map(c => (
            <div key={c.label} style={{ background: "var(--surface2)", borderRadius: "var(--radius-sm)", padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>

        {todayRec?.sessions?.length > 0 && (
          <div style={{ marginBottom: 14, background: "var(--surface2)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
              Today&apos;s Sessions ({todayRec.sessions.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {todayRec.sessions.map((s, idx) => (
                <div key={s.id || idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>
                    Session #{idx + 1}: {formatTime(s.checkIn, s.checkInTz)} – {s.checkOut ? formatTime(s.checkOut, s.checkOutTz || s.checkInTz) : "Active 🟢"}
                  </span>
                  <span style={{ color: s.checkOut ? "var(--text2)" : "var(--success)", fontWeight: 600 }}>
                    {s.checkOut ? formatHours(s.hoursWorked) : "In Progress"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(!todayRec || (todayRec && !isIn)) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>Work Mode:</span>
            {[
              { id: "WFO", label: "🏢 Office (WFO)" },
              { id: "WFH", label: "🏠 Remote (WFH)" },
              { id: "ON_DUTY", label: "✈️ On Duty (OD)" },
            ].map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setWorkMode(m.id)}
                style={{
                  padding: "5px 10px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: workMode === m.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: workMode === m.id ? "rgba(79,142,247,0.18)" : "var(--surface2)",
                  color: workMode === m.id ? "var(--accent)" : "var(--text2)",
                }}
              >
                {m.label}
              </button>
            ))}
            {geoStatus && <span style={{ fontSize: 11, color: "var(--text3)" }}>{geoStatus}</span>}
          </div>
        )}

        {!todayRec && <Btn onClick={handleCheckIn} loading={checking} variant="success" size="md" style={{ width: "100%", justifyContent: "center" }}>✅ Check In</Btn>}
        {isIn && <Btn onClick={handleCheckOut} loading={checking} variant="danger" size="md" style={{ width: "100%", justifyContent: "center" }}>🚪 Check Out</Btn>}
        {todayRec && !isIn && (
          <Btn onClick={handleCheckIn} loading={checking} variant="secondary" size="md" style={{ width: "100%", justifyContent: "center" }}>
            ▶️ Check In Again (Start Next Session)
          </Btn>
        )}
      </Card>

      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14 }}>
        <StatCard icon="✅" label="On Time" value={records.filter(r => !r.isLate && !r.isHalfDay).length} color="var(--success)" />
        <StatCard icon="⚠️" label="Late" value={records.filter(r => r.isLate).length} color="var(--warning)" />
        <StatCard icon="🌓" label="Half Days" value={records.filter(r => r.isHalfDay).length} color="var(--accent)" />
        <StatCard icon="⏱️" label="Total Hours" value={formatHours(totalH)} color="var(--accent2)" />
      </div>

      <Card>
        {loading ? <Skeleton height={300} /> : (
          <Table
            cols={[
              { key: "date", label: "Date", render: r => formatDate(r.date) },
              {
                key: "workMode", label: "Work Mode",
                render: r => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>
                      {r.workMode === "WFH" ? "🏠 Remote" : r.workMode === "ON_DUTY" ? "✈️ On Duty" : "🏢 Office"}
                    </span>
                    {r.workMode === "WFO" && (
                      <span style={{ fontSize: 10, color: r.locationVerified ? "var(--success)" : "var(--warning)" }}>
                        {r.locationVerified ? "🟢 Verified" : "⚠️ Out of fence"}{r.distanceMeters != null ? ` (${r.distanceMeters}m)` : ""}
                      </span>
                    )}
                  </div>
                ),
              },
              { key: "checkIn", label: "Check In", render: r => formatTime(r.checkIn, r.checkInTz) },
              { key: "checkOut", label: "Check Out", render: r => formatTime(r.checkOut, r.checkOutTz || r.checkInTz) },
              {
                key: "hours", label: "Hours",
                render: r => (
                  <div>
                    <span>{formatHours(r.hoursWorked)}</span>
                    {r.sessions?.length > 1 && (
                      <span style={{ fontSize: 11, color: "var(--accent)", marginLeft: 6 }}>
                        ({r.sessions.length} sessions)
                      </span>
                    )}
                  </div>
                ),
              },
              { key: "late", label: "Late By", render: r => r.isLate ? <span style={{ color: "var(--warning)" }}>+{r.lateMinutes}m</span> : "—" },
              { key: "status", label: "Status", render: r => <Badge status={resolveAttStatus(r)} /> },
            ]}
            rows={[...records].sort((a, b) => b.date.localeCompare(a.date))}
            emptyMsg="No attendance records for this month."
          />
        )}
      </Card>

      <Card>
        <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>My Correction Requests</h3>
        <Table cols={regCols} rows={regRequests} emptyMsg="No correction requests submitted yet." />
      </Card>

      {showRegModal && (
        <Modal title="Request Attendance Correction" onClose={closeRegModal} width={480}>
          <form onSubmit={submitRegularization} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Date">
              <input type="date" value={regForm.date} max={todayStr()}
                onChange={e => setRegField("date", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Check In">
                <input type="time" value={regForm.checkInTime} onChange={e => setRegField("checkInTime", e.target.value)} />
              </Field>
              <Field label="Check Out" hint="Leave blank if not applicable">
                <input type="time" value={regForm.checkOutTime} onChange={e => setRegField("checkOutTime", e.target.value)} />
              </Field>
            </div>
            <Field label="Reason">
              <textarea rows={3} value={regForm.reason} onChange={e => setRegField("reason", e.target.value)}
                placeholder="e.g. Forgot to check in, system was down…" style={{ resize: "vertical" }} />
            </Field>

            {regError && (
              <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(240,68,68,.1)", borderRadius: "var(--radius-sm)" }}>
                ⚠️ {regError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="ghost" onClick={closeRegModal} disabled={regSaving} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
              <Btn type="submit" loading={regSaving} style={{ flex: 1, justifyContent: "center" }}>Submit Request</Btn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}