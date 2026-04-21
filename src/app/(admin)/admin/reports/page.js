// src/app/(admin)/admin/reports/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, SectionHeader, Btn, Skeleton, Avatar } from "@/components/ui";
import { formatHours, downloadCSV, empColor, empInitials } from "@/lib/utils";

export default function AdminReportsPage() {
  const { authFetch } = useAuthContext();
  const now           = new Date();
  const [month,   setMonth]   = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    const [y, m] = month.split("-").map(Number);
    const res    = await authFetch(`/api/reports/monthly?year=${y}&month=${m}`);
    const json   = await res.json();
    setData(json.summary || []);
    setLoading(false);
  }, [month, authFetch]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const maxH = Math.max(...data.map(s => s.totalHours || 0), 1);

  const handleExport = () => {
    const headers = ["Employee","Department","Present Days","Late Days","Half Days","Total Hours","Avg Hours/Day"];
    const rows    = data.map(s => [s.name, s.department, s.present, s.late, s.halfDay, s.totalHours, s.avgHours]);
    downloadCSV([headers, ...rows], `report-${month}.csv`);
  };

  const cols = [
    {
      key: "emp", label: "Employee",
      render: r => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar initials={empInitials(r.name)} size={28} color={empColor(r.name, r.id)} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{r.department}</div>
          </div>
        </div>
      ),
    },
    { key: "present", label: "Present Days" },
    { key: "late",    label: "Late",         render: r => <span style={{ color: r.late > 4 ? "var(--warning)" : "var(--text)" }}>{r.late}</span> },
    { key: "halfDay", label: "Half Days" },
    { key: "totalH",  label: "Total Hours",  render: r => formatHours(r.totalHours) },
    { key: "avgH",    label: "Avg / Day",    render: r => formatHours(r.avgHours) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader
        title="Reports"
        subtitle="Monthly attendance analytics"
        action={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: "auto" }} />
            <Btn variant="secondary" size="sm" onClick={handleExport}>📥 Export CSV</Btn>
          </div>
        }
      />

      <Card>
        <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 20 }}>
          Hours Worked — {month}
        </h3>
        {loading ? <Skeleton height={200} /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.map(s => {
              const color = empColor(s.name, s.id);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 110, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <Avatar initials={empInitials(s.name)} size={24} color={color} />
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(s.name || "").split(" ")[0]}
                    </span>
                  </div>
                  <div style={{ flex: 1, height: 30, background: "var(--surface2)", borderRadius: "var(--radius-sm)", overflow: "hidden", position: "relative" }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      width: `${((s.totalHours || 0) / maxH) * 100}%`,
                      background: `linear-gradient(90deg,${color}cc,${color}66)`,
                      borderRadius: "var(--radius-sm)",
                      display: "flex", alignItems: "center", paddingLeft: 10,
                      transition: "width .6s ease",
                    }}>
                      {(s.totalHours || 0) > 5 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
                          {formatHours(s.totalHours)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ width: 36, textAlign: "right", fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>
                    {s.present}d
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Monthly Summary</h3>
        {loading ? <Skeleton height={200} /> : <Table cols={cols} rows={data} emptyMsg="No data for this month." />}
      </Card>
    </div>
  );
}
