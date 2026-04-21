// src/app/(employee)/employee/dashboard/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, StatCard, Badge, Table, SectionHeader, LiveClock, Btn, Skeleton } from "@/components/ui";
import { formatTime, formatDate, formatHours, resolveAttStatus, LEAVE_CONFIG } from "@/lib/utils";

export default function EmployeeDashboardPage() {
  const { user, authFetch, socketOn } = useAuthContext();
  // todayRec: null = definitively no record (after fetch), undefined = still loading
  // Previously this ambiguity allowed the check-in button to appear before the
  // API response arrived, risking a duplicate check-in on fast clicks.
  // Now the button is also gated on `!loading`.
  const [todayRec, setTodayRec] = useState(undefined);
  const [monthAtt, setMonthAtt] = useState([]);
  const [balance,  setBalance]  = useState(null);
  const [myLeaves, setMyLeaves] = useState([]);
  const [elapsed,  setElapsed]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState(false);
  const [toast,    setToast]    = useState(null);

  const [mounted,      setMounted]      = useState(false);
  const [currentDate,  setCurrentDate]  = useState("");
  const [greetingText, setGreetingText] = useState("");

  const month = new Date().toISOString().slice(0, 7);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [todayRes, monthRes, balRes, lvRes] = await Promise.all([
        authFetch("/api/attendance/today"),
        authFetch(`/api/attendance?month=${month}&limit=60`),
        authFetch("/api/leaves/balance"),
        authFetch("/api/leaves?limit=5"),
      ]);
      const [today, monthData, balData, lvData] = await Promise.all([
        todayRes.json(), monthRes.json(), balRes.json(), lvRes.json(),
      ]);
      setTodayRec(today.record ?? null);  // explicitly null when absent
      setMonthAtt(monthData.records || []);
      setBalance(balData.balance);
      setMyLeaves(lvData.leaves || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authFetch, month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    setMounted(true);
    setCurrentDate(new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    }));
    const hour = new Date().getHours();
    setGreetingText(hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening");
  }, []);

  useEffect(() => {
    if (!todayRec?.checkIn || todayRec?.checkOut) { setElapsed(null); return; }
    const tick = () => setElapsed((Date.now() - new Date(todayRec.checkIn).getTime()) / 3_600_000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [todayRec]);

  useEffect(() => {
    const off = socketOn("leave:reviewed", fetchAll);
    return off;
  }, [socketOn, fetchAll]);

  const handleCheckIn = async () => {
    setChecking(true);
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await authFetch("/api/attendance", {
      method: "POST", body: JSON.stringify({ timezone: tz }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.isLate ? "Checked in — marked Late ⚠️" : "Checked in successfully ✅", data.isLate ? "warning" : "success");
      fetchAll();
    } else {
      showToast(data.error || "Check-in failed", "error");
    }
    setChecking(false);
  };

  const handleCheckOut = async () => {
    setChecking(true);
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await authFetch("/api/attendance/checkout", {
      method: "PATCH", body: JSON.stringify({ timezone: tz }),
    });
    if (res.ok) {
      showToast("Checked out — see you tomorrow 👋", "success");
      fetchAll();
    } else {
      const data = await res.json();
      showToast(data.error || "Check-out failed", "error");
    }
    setChecking(false);
  };

  if (!mounted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 800 }}>Loading...</h1>
          <p style={{ color: "var(--text2)", fontSize: 14, marginTop: 3 }}>Please wait</p>
        </div>
        <Skeleton height={220} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {[...Array(4)].map((_,i) => <Skeleton key={i} height={110} />)}
        </div>
        <Skeleton height={250} />
      </div>
    );
  }

  if (loading) return <DashSkeleton />;

  const isCheckedIn  = todayRec && !todayRec.checkOut;
  const isCheckedOut = todayRec && !!todayRec.checkOut;

  const avail = (key) => {
    if (!balance) return 0;
    const k = key.toLowerCase();
    return Math.max(0,
      (balance[`${k}Total`]   || 0) -
      (balance[`${k}Used`]    || 0) -
      (balance[`${k}Pending`] || 0),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "rgba(34,211,165,.15)" : toast.type === "error" ? "rgba(240,68,68,.15)" : "var(--surface2)",
          border: `1px solid ${toast.type === "success" ? "var(--success)" : toast.type === "error" ? "var(--danger)" : "var(--warning)"}`,
          borderRadius: "var(--radius-md)", padding: "12px 18px",
          color: "var(--text)", fontSize: 14, fontWeight: 500, minWidth: 260,
        }} className="fade-up">{toast.msg}</div>
      )}

      <div>
        <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 800 }}>
          Good {greetingText}, {user?.name?.split(" ")[0]} 👋
        </h1>
        <p style={{ color: "var(--text2)", fontSize: 14, marginTop: 3 }}>{currentDate}</p>
      </div>

      {/* Check-in widget */}
      <Card style={{ background: "linear-gradient(135deg,rgba(79,142,247,.07),rgba(124,92,252,.07))", border: "1px solid rgba(79,142,247,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>
              Today's Attendance
            </div>
            <div style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 800 }}>
              {isCheckedOut ? "✅ Completed" : isCheckedIn ? "🟢 In Office" : "⚪ Not Checked In"}
            </div>
            {todayRec?.isLate && (
              <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 5 }}>
                ⚠️ Arrived {todayRec.lateMinutes} min late
              </div>
            )}
          </div>
          <LiveClock />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 18 }}>
          {[
            { icon: "🕗", label: "Check In",    value: formatTime(todayRec?.checkIn) },
            { icon: "🕔", label: "Check Out",   value: formatTime(todayRec?.checkOut) },
            { icon: "⏱️", label: "Hours Today", value: isCheckedIn && elapsed != null ? formatHours(elapsed) : formatHours(todayRec?.hoursWorked), highlight: !!isCheckedIn },
          ].map(c => (
            <div key={c.label} style={{
              background: "var(--surface2)", borderRadius: "var(--radius-md)", padding: 14, textAlign: "center",
              border: c.highlight ? "1px solid rgba(79,142,247,.3)" : "1px solid transparent",
            }}>
              <div style={{ fontSize: 20, marginBottom: 5 }}>{c.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "Syne, sans-serif", color: c.highlight ? "var(--accent)" : "var(--text)" }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {/* Button is disabled while loading OR checking to prevent duplicate submissions.
              Previously `!todayRec` was true for both `undefined` (loading) and `null`
              (not checked in), making the button appear and clickable before the API
              responded. Now we explicitly require !loading as well. */}
          {!loading && !todayRec && (
            <Btn onClick={handleCheckIn} loading={checking} disabled={checking} variant="success" size="lg" style={{ width: "100%", justifyContent: "center" }}>
              ✅ Check In
            </Btn>
          )}
          {!loading && isCheckedIn && (
            <Btn onClick={handleCheckOut} loading={checking} disabled={checking} variant="danger" size="lg" style={{ width: "100%", justifyContent: "center" }}>
              🚪 Check Out
            </Btn>
          )}
          {isCheckedOut && (
            <div style={{ textAlign: "center", color: "var(--text2)", fontSize: 14, padding: "12px 0" }}>
              🎉 Work day complete — {formatHours(todayRec.hoursWorked)} logged
            </div>
          )}
        </div>
      </Card>

      <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 14 }}>
        <StatCard icon="✅" label="Present"      value={monthAtt.length}                          sub="This month" color="var(--success)" />
        <StatCard icon="⚠️" label="Late"         value={monthAtt.filter(a => a.isLate).length}    sub="This month" color="var(--warning)" />
        <StatCard icon="🏖️" label="Casual Leave" value={avail("CL")} sub={`of ${balance?.clTotal || 12} days`} color="var(--accent)"  />
        <StatCard icon="🏥" label="Sick Leave"   value={avail("SL")} sub={`of ${balance?.slTotal || 10} days`} color="var(--accent2)" />
      </div>

      <Card>
        <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Recent Attendance</h3>
        <Table
          cols={[
            { key: "date",     label: "Date",      render: r => formatDate(r.date) },
            { key: "checkIn",  label: "Check In",  render: r => formatTime(r.checkIn) },
            { key: "checkOut", label: "Check Out", render: r => formatTime(r.checkOut) },
            { key: "hours",    label: "Hours",     render: r => formatHours(r.hoursWorked) },
            { key: "status",   label: "Status",    render: r => <Badge status={resolveAttStatus(r)} /> },
          ]}
          rows={[...monthAtt].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)}
        />
      </Card>

      <Card>
        <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Recent Leave Requests</h3>
        <Table
          cols={[
            { key: "type",   label: "Type",   render: r => `${LEAVE_CONFIG[r.type]?.emoji||""} ${LEAVE_CONFIG[r.type]?.label||r.type}` },
            { key: "from",   label: "From",   render: r => formatDate(r.startDate) },
            { key: "to",     label: "To",     render: r => formatDate(r.endDate) },
            { key: "days",   label: "Days" },
            { key: "status", label: "Status", render: r => <Badge status={r.status?.toLowerCase()} /> },
          ]}
          rows={myLeaves}
          emptyMsg="No leave requests yet."
        />
      </Card>
    </div>
  );
}

function DashSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Skeleton height={32} width={280} />
      <Skeleton height={220} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {[...Array(4)].map((_,i) => <Skeleton key={i} height={110} />)}
      </div>
      <Skeleton height={250} />
    </div>
  );
}
