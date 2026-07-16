// src/app/(admin)/admin/dashboard/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, StatCard, Badge, Avatar, SectionHeader, Skeleton, EmpCell } from "@/components/ui";
import { formatTime, formatDate, resolveAttStatus, empColor, empInitials, todayStr } from "@/lib/utils";

export default function AdminDashboardPage() {
  const { authFetch, socketOn } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [todayAtt, setTodayAtt] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [pending, setPending] = useState([]);
  const [holidaysToday, setHolidaysToday] = useState([]);

  const today = todayStr();

  const fetchAll = useCallback(async () => {
    try {
      const yearNow = new Date().getFullYear();
      const [usersRes, todayRes, actRes, pendingRes, holRes] = await Promise.all([
        authFetch("/api/users"),
        authFetch(`/api/attendance?date=${today}&limit=50`),
        authFetch(`/api/attendance?limit=10`),
        authFetch("/api/leaves?status=PENDING&limit=6"),
        authFetch(`/api/holidays?year=${yearNow}`),
      ]);
      const [users, todayData, actData, pendingData, holData] = await Promise.all([
        usersRes.json(), todayRes.json(), actRes.json(), pendingRes.json(), holRes.json(),
      ]);
      setAllUsers((users.users || []).filter(u => u.role === "EMPLOYEE"));
      setTodayAtt(todayData.records || []);
      setActivity(actData.records || []);
      setPending(pendingData.leaves || []);
      setHolidaysToday((holData.holidays || []).filter(h => h.date === today));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch, today]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const off1 = socketOn("attendance:checkin", fetchAll);
    const off2 = socketOn("attendance:checkout", fetchAll);
    const off3 = socketOn("leave:applied", fetchAll);
    return () => { off1(); off2(); off3(); };
  }, [socketOn, fetchAll]);

  if (loading) return <DashboardSkeleton />;

  // A holiday applies to an employee if it's company-wide (no department) or
  // scoped specifically to their department.
  const isHolidayForEmp = (emp) =>
    holidaysToday.some(h => !h.department || h.department === emp.department);

  const companyWideHoliday = holidaysToday.find(h => !h.department);

  const presentCount = todayAtt.length;
  const empCount = allUsers.length;
  const lateCount = todayAtt.filter(a => a.isLate).length;
  const onHolidayCount = allUsers.filter(emp =>
    !todayAtt.find(a => a.userId === emp.id) && isHolidayForEmp(emp),
  ).length;
  const absentCount = Math.max(0, empCount - presentCount - onHolidayCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <SectionHeader
        title="Admin Dashboard"
        subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      />

      {companyWideHoliday && (
        <Card style={{ background: "rgba(124,92,252,.08)", border: "1px solid rgba(124,92,252,.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Today is a company holiday — {companyWideHoliday.name}</div>
              {companyWideHoliday.description && (
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{companyWideHoliday.description}</div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="stagger stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
        <StatCard icon="👥" label="Total Employees" value={empCount} color="var(--accent)" trend={5} />
        <StatCard icon="✅" label="Present Today" value={presentCount} color="var(--success)" sub={empCount ? `${Math.round(presentCount / empCount * 100)}% rate` : ""} />
        <StatCard icon="⚠️" label="Late Today" value={lateCount} color="var(--warning)" />
        <StatCard icon="🎉" label="On Holiday" value={onHolidayCount} color="var(--accent2)" />
        <StatCard icon="🔴" label="Absent Today" value={absentCount} color="var(--danger)" />
        <StatCard icon="📋" label="Pending Leaves" value={pending.length} color="var(--accent2)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Live feed */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15 }}>Live Activity</h3>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.length === 0 && <p style={{ color: "var(--text3)", fontSize: 13 }}>No activity yet today.</p>}
            {activity.map((r, i) => {
              const emp = r.user;
              const color = empColor(emp?.name, emp?.id);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--surface2)", borderRadius: "var(--radius-md)" }}>
                  <Avatar initials={empInitials(emp?.name)} size={30} color={color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">{emp?.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {r.checkOut ? "Checked out" : "Checked in"} · {r.date} {r.checkOut ? formatTime(r.checkOut, r.checkOutTz || r.checkInTz) : formatTime(r.checkIn, r.checkInTz)}
                    </div>
                  </div>
                  <Badge status={r.checkOut ? "checked-out" : "checkedin"} />
                </div>
              );
            })}
          </div>
        </Card>

        {/* Today's roster */}
        <Card>
          <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Today's Roster</h3>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {allUsers.map(emp => {
              const rec = todayAtt.find(a => a.userId === emp.id);
              const color = empColor(emp.name, emp.id);
              const empOnHoliday = !rec && isHolidayForEmp(emp);
              return (
                <div key={emp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <Avatar initials={empInitials(emp.name)} size={32} color={color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">{emp.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{emp.department}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                    <Badge status={rec ? resolveAttStatus(rec) : empOnHoliday ? "holiday" : "absent"} />
                    {rec && <span style={{ fontSize: 10, color: "var(--text3)" }}>{formatTime(rec.checkIn, rec.checkInTz)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <Card style={{ border: "1px solid rgba(245,166,35,.22)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15 }}>⏳ Pending Approvals</h3>
            <span style={{ fontSize: 12, color: "var(--warning)", fontWeight: 600 }}>{pending.length} request{pending.length !== 1 ? "s" : ""}</span>
          </div>
          {pending.map(l => {
            const emp = l.employee;
            const color = empColor(emp?.name, emp?.id);
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <Avatar initials={empInitials(emp?.name)} size={34} color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">
                    {emp?.name} <span style={{ color: "var(--text2)", fontWeight: 400 }}>· {l.type}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    {formatDate(l.startDate)} → {formatDate(l.endDate)} · {l.days} day{l.days !== 1 ? "s" : ""}
                  </div>
                </div>
                <Badge status="pending" />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Skeleton height={32} width={300} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
        {[...Array(5)].map((_, i) => <Skeleton key={i} height={110} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Skeleton height={320} />
        <Skeleton height={320} />
      </div>
    </div>
  );
}