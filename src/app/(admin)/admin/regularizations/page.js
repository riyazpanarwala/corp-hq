// src/app/(admin)/admin/regularizations/page.js
"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { Card, Table, Badge, Btn, Modal, Tabs, SectionHeader, Avatar, Field, Skeleton, ToastStack, useToast } from "@/components/ui";
import { formatDate, empColor, empInitials } from "@/lib/utils";

export default function AdminRegularizationsPage() {
    const { authFetch, socketOn } = useAuthContext();
    const [requests, setRequests] = useState([]);
    const [counts, setCounts] = useState({});
    const [tab, setTab] = useState("PENDING");
    const [review, setReview] = useState(null);
    const [note, setNote] = useState("");
    const [loading, setLoading] = useState(true);
    const [reviewingAction, setReviewingAction] = useState(null);
    const { toasts, toast, remove } = useToast();

    const fetchRequests = useCallback(async () => {
        setLoading(true);
        const [tabRes, pendRes, appRes, rejRes] = await Promise.all([
            authFetch(`/api/attendance/regularize?status=${tab}&limit=50`),
            authFetch("/api/attendance/regularize?status=PENDING&limit=1"),
            authFetch("/api/attendance/regularize?status=APPROVED&limit=1"),
            authFetch("/api/attendance/regularize?status=REJECTED&limit=1"),
        ]);
        const [tabData, p, a, r] = await Promise.all([tabRes.json(), pendRes.json(), appRes.json(), rejRes.json()]);
        setRequests(tabData.requests || []);
        setCounts({ PENDING: p.pagination?.total || 0, APPROVED: a.pagination?.total || 0, REJECTED: r.pagination?.total || 0 });
        setLoading(false);
    }, [tab, authFetch]);

    useEffect(() => { fetchRequests(); }, [fetchRequests]);

    useEffect(() => {
        const off = socketOn("regularization:requested", fetchRequests);
        return off;
    }, [socketOn, fetchRequests]);

    const handleReview = async (action) => {
        if (!review || reviewingAction) return;
        setReviewingAction(action);
        try {
            const res = await authFetch(`/api/attendance/regularize/${review.id}`, {
                method: "PATCH",
                body: JSON.stringify({ action, reviewNote: note }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast(data?.error || "Failed to process review.", "error");
                return;
            }
            setReview(null);
            setNote("");
            fetchRequests();
            toast(action === "APPROVED" ? "Regularization approved — attendance updated." : "Regularization rejected.", "success");
        } catch (err) {
            toast(err.message || "Network error. Please try again.", "error");
        } finally {
            setReviewingAction(null);
        }
    };

    const closeReview = () => {
        if (reviewingAction) return;
        setReview(null);
        setNote("");
    };

    const TABS = [
        { id: "PENDING", label: "Pending", count: counts.PENDING || 0 },
        { id: "APPROVED", label: "Approved", count: counts.APPROVED || 0 },
        { id: "REJECTED", label: "Rejected", count: counts.REJECTED || 0 },
        { id: "all", label: "All" },
    ];

    const cols = [
        {
            key: "emp", label: "Employee",
            render: r => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar initials={empInitials(r.employee?.name)} size={28} color={empColor(r.employee?.name, r.employee?.id)} />
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee?.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)" }}>{r.employee?.department}</div>
                    </div>
                </div>
            ),
        },
        { key: "date", label: "Date", render: r => formatDate(r.date) },
        { key: "checkIn", label: "Check In", render: r => r.requestedCheckIn },
        { key: "checkOut", label: "Check Out", render: r => r.requestedCheckOut || "—" },
        { key: "reason", label: "Reason", render: r => <span className="truncate" style={{ color: "var(--text2)", maxWidth: 160, display: "block" }}>{r.reason}</span> },
        { key: "status", label: "Status", render: r => <Badge status={r.status?.toLowerCase()} /> },
        {
            key: "action", label: "Action",
            render: r => r.status === "PENDING"
                ? <Btn size="xs" variant="secondary" onClick={() => { setReview(r); setNote(""); setReviewingAction(null); }}>Review</Btn>
                : (r.reviewNote ? <span style={{ fontSize: 12, color: "var(--text3)", maxWidth: 140, display: "block" }} className="truncate">{r.reviewNote}</span> : "—"),
        },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <SectionHeader title="Attendance Regularizations" subtitle="Review employee requests to correct check-in / check-out times" />
            <Tabs tabs={TABS} active={tab} onChange={setTab} />
            <Card>
                {loading ? <Skeleton height={300} /> : <Table cols={cols} rows={requests} emptyMsg="No regularization requests found." />}
            </Card>

            {review && (
                <Modal title="Review Regularization Request" onClose={closeReview}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <div style={{ padding: 16, background: "var(--surface2)", borderRadius: "var(--radius-md)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                <Avatar initials={empInitials(review.employee?.name)} size={40} color={empColor(review.employee?.name, review.employee?.id)} />
                                <div>
                                    <div style={{ fontWeight: 700 }}>{review.employee?.name}</div>
                                    <div style={{ fontSize: 12, color: "var(--text3)" }}>{review.employee?.department}</div>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                                {[
                                    ["Date", formatDate(review.date)],
                                    ["Check In", review.requestedCheckIn],
                                    ["Check Out", review.requestedCheckOut || "Not provided"],
                                    ["Timezone", review.timezone],
                                ].map(([k, v]) => (
                                    <div key={k}><span style={{ color: "var(--text2)" }}>{k}: </span><strong>{v}</strong></div>
                                ))}
                            </div>
                            <div style={{ marginTop: 10, fontSize: 13 }}><span style={{ color: "var(--text2)" }}>Reason: </span>{review.reason}</div>
                        </div>
                        <Field label="Review Note (optional)">
                            <textarea
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={2}
                                placeholder="Add a note for the employee…"
                                style={{ resize: "none" }}
                                disabled={!!reviewingAction}
                            />
                        </Field>
                        <div style={{ display: "flex", gap: 10 }}>
                            <Btn variant="danger" loading={reviewingAction === "REJECTED"} disabled={!!reviewingAction}
                                onClick={() => handleReview("REJECTED")} style={{ flex: 1, justifyContent: "center" }}>❌ Reject</Btn>
                            <Btn variant="success" loading={reviewingAction === "APPROVED"} disabled={!!reviewingAction}
                                onClick={() => handleReview("APPROVED")} style={{ flex: 1, justifyContent: "center" }}>✅ Approve & Apply</Btn>
                        </div>
                    </div>
                </Modal>
            )}

            <ToastStack toasts={toasts} remove={remove} />
        </div>
    );
}