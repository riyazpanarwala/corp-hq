// src/app/(admin)/admin/employees/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Badge, Avatar, SectionHeader, Skeleton, Btn, Modal, Field, ToastStack, useToast } from "@/components/ui";
import { formatTime, resolveAttStatus, empColor, empInitials, todayStr } from "@/lib/utils";

const EMPTY_FORM = {
  name: "",
  email: "",
  department: "",
  designation: "",
  timezone: "Asia/Kolkata",
  password: "",
};

export default function AdminEmployeesPage() {
  const { authFetch } = useAuthContext();
  const [employees, setEmployees] = useState([]);
  const [todayAtt,  setTodayAtt]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [showAdd,   setShowAdd]   = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving,    setSaving]    = useState(false);
  const [removeEmp, setRemoveEmp] = useState(null);
  const [removing,  setRemoving]  = useState(false);
  const { toasts, toast, remove } = useToast();

  const today = todayStr();

  const fetchAll = useCallback(async () => {
    const [usersRes, todayRes] = await Promise.all([
      authFetch("/api/users"),
      authFetch(`/api/attendance?date=${today}&limit=50`),
    ]);
    const [usersData, todayData] = await Promise.all([usersRes.json(), todayRes.json()]);
    setEmployees((usersData.users || []).filter(u => u.role === "EMPLOYEE"));
    setTodayAtt(todayData.records || []);
    setLoading(false);
  }, [authFetch, today]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const setField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (formError) setFormError("");
  };

  const closeAdd = () => {
    if (saving) return;
    setShowAdd(false);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const addEmployee = async (e) => {
    e.preventDefault();
    setFormError("");

    const payload = {
      ...form,
      role: "EMPLOYEE",
      name: form.name.trim(),
      email: form.email.trim(),
      department: form.department.trim(),
      designation: form.designation.trim(),
      timezone: form.timezone.trim() || "UTC",
    };

    if (!payload.name || !payload.email || !payload.department || !payload.password) {
      setFormError("Name, email, department, and password are required.");
      return;
    }

    if (payload.password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Could not add employee.");
      }

      await fetchAll();
      toast(`${payload.name} added to the team.`, "success");
      setShowAdd(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message || "Could not add employee.");
    } finally {
      setSaving(false);
    }
  };

  const removeEmployee = async () => {
    if (!removeEmp) return;

    setRemoving(true);
    try {
      const res = await authFetch(`/api/users/${removeEmp.id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Could not remove employee.");
      }

      await fetchAll();
      toast(`${removeEmp.name} removed from active employees.`, "success");
      setRemoveEmp(null);
    } catch (err) {
      toast(err.message || "Could not remove employee.", "error");
    } finally {
      setRemoving(false);
    }
  };

  const filtered = employees.filter(e =>
    !search ||
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.department?.toLowerCase().includes(search.toLowerCase()),
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
      <SectionHeader
        title="Employees"
        subtitle={`${employees.length} team members`}
        action={<Btn onClick={() => setShowAdd(true)}>+ New Employee</Btn>}
      />
      <div style={{ maxWidth: 300 }}>
        <input placeholder="Search name or department..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
        {filtered.map(emp => {
          const todayRec = todayAtt.find(a => a.userId === emp.id);
          const color    = empColor(emp.name, emp.id);
          return (
            <Card key={emp.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <Avatar initials={empInitials(emp.name)} size={46} color={color} />
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
                      {todayRec ? formatTime(todayRec.checkIn, todayRec.checkInTz) : "-"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>Today In</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{emp.timezone}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge status={emp.role.toLowerCase()} />
                  <Btn variant="ghost" size="xs" onClick={() => setRemoveEmp(emp)}>Remove</Btn>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {showAdd && (
        <Modal title="Add Employee" onClose={closeAdd} width={560}>
          <form onSubmit={addEmployee} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <Field label="Full name">
                <input value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Alex Morgan" autoFocus />
              </Field>
              <Field label="Email">
                <input type="email" value={form.email} onChange={e => setField("email", e.target.value)} placeholder="alex@corp.io" />
              </Field>
              <Field label="Department">
                <input value={form.department} onChange={e => setField("department", e.target.value)} placeholder="Engineering" />
              </Field>
              <Field label="Designation">
                <input value={form.designation} onChange={e => setField("designation", e.target.value)} placeholder="Software Engineer" />
              </Field>
              <Field label="Timezone">
                <input value={form.timezone} onChange={e => setField("timezone", e.target.value)} placeholder="Asia/Kolkata" />
              </Field>
              <Field label="Temporary password" hint="Minimum 8 characters.">
                <input type="password" value={form.password} onChange={e => setField("password", e.target.value)} placeholder="password123" />
              </Field>
            </div>

            {formError && (
              <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {formError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <Btn variant="ghost" onClick={closeAdd} disabled={saving}>Cancel</Btn>
              <Btn type="submit" loading={saving}>Add Employee</Btn>
            </div>
          </form>
        </Modal>
      )}

      {removeEmp && (
        <Modal title="Remove Employee" onClose={() => !removing && setRemoveEmp(null)} width={440}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{removeEmp.name}</div>
              <div style={{ color: "var(--text2)", fontSize: 13 }}>
                This will remove the employee from active portal lists and prevent future login. Existing attendance and leave history will remain.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn variant="ghost" onClick={() => setRemoveEmp(null)} disabled={removing}>Cancel</Btn>
              <Btn variant="danger" loading={removing} onClick={removeEmployee}>Remove Employee</Btn>
            </div>
          </div>
        </Modal>
      )}

      <ToastStack toasts={toasts} remove={remove} />
    </div>
  );
}

