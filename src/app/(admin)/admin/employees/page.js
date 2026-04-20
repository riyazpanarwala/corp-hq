// src/app/(admin)/admin/employees/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Badge, Avatar, SectionHeader, Skeleton } from "@/components/ui";
import { formatTime, resolveAttStatus } from "@/lib/utils";

const COLORS = ["#4f8ef7","#7c5cfc","#22d3a5","#f5a623","#f04444"];
const col    = id => COLORS[(id||0) % COLORS.length];
const ini    = name => (name||"").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()||"??";

export default function AdminEmployeesPage() {
  const { authFetch } = useAuthContext();
  const [employees, setEmployees] = useState([]);
  const [todayAtt,  setTodayAtt]  = useState([]);
  const [balances,  setBalances]  = useState({});
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");

  const today    = new Date().toISOString().split("T")[0];
  const curMonth = new Date().toISOString().slice(0, 7);

  const fetchAll = useCallback(async () => {
    const [usersRes, todayRes] = await Promise.all([
      authFetch("/api/users"),
      authFetch(`/api/attendance?date=${today}&limit=50`),
    ]);
    const [usersData, todayData] = await Promise.all([usersRes.json(), todayRes.json()]);
    const emps = (usersData.users || []).filter(u => u.role === "EMPLOYEE");
    setEmployees(emps);
    setTodayAtt(todayData.records || []);
    setLoading(false);
  }, [authFetch, today]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = employees.filter(e =>
    !search ||
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.department.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Skeleton height={32} width={200} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
          {[...Array(6)].map((_,i) => <Skeleton key={i} height={180} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Employees" subtitle={`${employees.length} team members`} />
      <div style={{ maxWidth: 300 }}>
        <input placeholder="🔍  Search name or department…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
        {filtered.map(emp => {
          const todayRec = todayAtt.find(a => a.userId === emp.id);
          return (
            <Card key={emp.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <Avatar initials={ini(emp.name)} size={46} color={col(emp.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text2)" }}>{emp.designation}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{emp.email}</div>
                </div>
                <Badge status={todayRec ? resolveAttStatus(todayRec) : "absent"} />
              </div>

              <div style={{ background: "var(--surface2)", borderRadius: "var(--radius-md)", padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{emp.department}</div>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>Department</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {todayRec ? formatTime(todayRec.checkIn) : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>Today In</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{emp.timezone}</span>
                <Badge status={emp.role.toLowerCase()} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
