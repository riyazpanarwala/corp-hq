// src/app/(admin)/admin/holidays/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Btn, Modal, Field, SectionHeader, Skeleton, ToastStack, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";

const EMPTY_FORM = { date: "", name: "", description: "", department: "" };

export default function AdminHolidaysPage() {
    const { authFetch } = useAuthContext();
    const [holidays, setHolidays] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [year, setYear] = useState(new Date().getFullYear());
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);
    const [removeTarget, setRemoveTarget] = useState(null);
    const [removing, setRemoving] = useState(false);
    const { toasts, toast, remove } = useToast();

    // FIX (CodeRabbit #9 — failed fetch left the page loading forever):
    // previously there was no try/catch/finally, so a network error left
    // setLoading(true) in place permanently with no error shown.
    const fetchHolidays = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`/api/holidays?year=${year}`);
            const data = await res.json();
            setHolidays(data.holidays || []);
        } catch (err) {
            toast("Could not load holidays. Please try again.", "error");
        } finally {
            setLoading(false);
        }
    }, [authFetch, year, toast]);

    // FIX (CodeRabbit #9 — free-text department field): departments are now
    // fetched from real employee records and used to populate a <select>,
    // so a typo can no longer create a holiday that silently applies to
    // nobody.
    const fetchDepartments = useCallback(async () => {
        try {
            const res = await authFetch("/api/departments");
            const data = await res.json();
            setDepartments(data.departments || []);
        } catch {
            // Non-fatal — the department select just falls back to "All departments" only.
        }
    }, [authFetch]);

    useEffect(() => { fetchHolidays(); }, [fetchHolidays]);
    useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

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

    const addHoliday = async (e) => {
        e.preventDefault();
        setFormError("");
        if (!form.date || !form.name.trim()) {
            setFormError("Date and name are required.");
            return;
        }
        setSaving(true);
        try {
            const res = await authFetch("/api/holidays", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: form.date,
                    name: form.name.trim(),
                    description: form.description.trim() || undefined,
                    department: form.department.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Could not add holiday.");
            await fetchHolidays();
            toast(`${form.name} added to the calendar.`, "success");
            // FIX (CodeRabbit #9 — modal stayed open after success): calling
            // closeAdd() here is guarded by `if (saving) return`, and saving
            // is still true at this point (setSaving(false) hasn't run yet).
            // Close and reset directly instead of going through the
            // saving-guarded helper.
            setShowAdd(false);
            setForm(EMPTY_FORM);
        } catch (err) {
            setFormError(err.message || "Could not add holiday.");
        } finally {
            setSaving(false);
        }
    };

    const removeHoliday = async () => {
        if (!removeTarget) return;
        setRemoving(true);
        try {
            const res = await authFetch(`/api/holidays/${removeTarget.id}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Could not remove holiday.");
            await fetchHolidays();
            toast(`${removeTarget.name} removed.`, "success");
            setRemoveTarget(null);
        } catch (err) {
            toast(err.message || "Could not remove holiday.", "error");
        } finally {
            setRemoving(false);
        }
    };

    const cols = [
        { key: "date", label: "Date", render: h => formatDate(h.date) },
        { key: "name", label: "Holiday" },
        {
            key: "department", label: "Scope",
            render: h => h.department
                ? <span style={{ fontSize: 12 }}>{h.department} only</span>
                : <span style={{ fontSize: 12, color: "var(--success)" }}>All departments</span>,
        },
        { key: "description", label: "Notes", render: h => h.description ? <span style={{ fontSize: 12, color: "var(--text3)" }}>{h.description}</span> : "—" },
        { key: "action", label: "", render: h => <Btn size="xs" variant="ghost" onClick={() => setRemoveTarget(h)}>Remove</Btn> },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <SectionHeader
                title="Holiday Calendar"
                subtitle="Company holidays used across attendance and leave calculations"
                action={
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: "auto" }}>
                            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <Btn onClick={() => setShowAdd(true)}>+ Add Holiday</Btn>
                    </div>
                }
            />

            <Card>
                {loading ? <Skeleton height={280} /> : (
                    <Table cols={cols} rows={holidays} emptyMsg={`No holidays configured for ${year}.`} />
                )}
            </Card>

            {showAdd && (
                <Modal title="Add Holiday" onClose={closeAdd} width={480}>
                    <form onSubmit={addHoliday} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <Field label="Date">
                            <input type="date" value={form.date} onChange={e => setField("date", e.target.value)} autoFocus />
                        </Field>
                        <Field label="Holiday name">
                            <input value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Independence Day" />
                        </Field>
                        <Field label="Department" hint="Leave as 'All departments' for a company-wide holiday">
                            <select value={form.department} onChange={e => setField("department", e.target.value)}>
                                <option value="">All departments</option>
                                {departments.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </Field>
                        <Field label="Notes (optional)">
                            <textarea rows={2} value={form.description} onChange={e => setField("description", e.target.value)} style={{ resize: "vertical" }} />
                        </Field>

                        {formError && <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{formError}</div>}

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                            <Btn variant="ghost" onClick={closeAdd} disabled={saving}>Cancel</Btn>
                            <Btn type="submit" loading={saving}>Add Holiday</Btn>
                        </div>
                    </form>
                </Modal>
            )}

            {removeTarget && (
                <Modal title="Remove Holiday" onClose={() => !removing && setRemoveTarget(null)} width={420}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ fontSize: 14 }}>
                            Remove <strong>{removeTarget.name}</strong> ({formatDate(removeTarget.date)}) from the calendar?
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                            <Btn variant="ghost" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Btn>
                            <Btn variant="danger" loading={removing} onClick={removeHoliday}>Remove</Btn>
                        </div>
                    </div>
                </Modal>
            )}

            <ToastStack toasts={toasts} remove={remove} />
        </div>
    );
}