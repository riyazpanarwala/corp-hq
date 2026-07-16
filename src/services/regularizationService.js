// src/services/regularizationService.js
const { db } = require("../lib/db");
const { ApiError } = require("../lib/auth");
const { emitToAdmins, emitToUser } = require("../lib/socket");
const { attendanceService } = require("./attendanceService");

const regularizationService = {
    async request(userId, { date, checkInTime, checkOutTime, timezone, reason }) {
        const workDate = new Date(`${date}T00:00:00.000Z`);

        const existing = await db.attendanceRegularization.findFirst({
            where: { userId, date: workDate, status: "PENDING" },
        });
        if (existing) {
            throw new ApiError("A pending regularization request already exists for this date", 409, "DUPLICATE_REQUEST");
        }

        const req = await db.attendanceRegularization.create({
            data: {
                userId, date: workDate,
                requestedCheckIn: checkInTime,
                requestedCheckOut: checkOutTime || null,
                timezone, reason, status: "PENDING",
            },
            include: { employee: { select: { id: true, name: true, department: true } } },
        });

        emitToAdmins("regularization:requested", {
            requestId: req.id, userId, userName: req.employee.name,
            date, checkInTime, checkOutTime: checkOutTime || null,
        });

        return req;
    },

    async cancel(id, userId) {
        const req = await db.attendanceRegularization.findUnique({ where: { id } });
        if (!req) throw new ApiError("Request not found", 404);
        if (req.userId !== userId) throw new ApiError("Unauthorized", 403);

        // Atomic conditional update — mirrors leaveService.cancel()'s race-safe pattern.
        const result = await db.attendanceRegularization.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "REJECTED", reviewNote: "Cancelled by employee", reviewedAt: new Date() },
        });
        if (result.count === 0) throw new ApiError("Only pending requests can be cancelled", 409);
    },

    // Same atomic-guard pattern as leaveService.review(): the status flip via
    // updateMany(WHERE status="PENDING") is the first write, so two concurrent
    // reviews of the same request can't both succeed.
    async review(id, adminId, { action, reviewNote }) {
        const req = await db.attendanceRegularization.findUnique({
            where: { id },
            include: { employee: { select: { id: true, name: true } } },
        });
        if (!req) throw new ApiError("Request not found", 404);

        const newStatus = action === "APPROVED" ? "APPROVED" : "REJECTED";

        const result = await db.attendanceRegularization.updateMany({
            where: { id, status: "PENDING" },
            data: { status: newStatus, reviewedById: adminId, reviewedAt: new Date(), reviewNote: reviewNote || null },
        });
        if (result.count === 0) throw new ApiError("This request has already been reviewed", 409);

        // Only touch attendance once the status flip has succeeded. Reuses
        // attendanceService.recordManual() — the exact same code path an admin's
        // own "Add Time" entry uses — so isLate / hoursWorked / isHalfDay are
        // computed identically instead of being reimplemented here.
        if (action === "APPROVED") {
            const dateStr = req.date.toISOString().split("T")[0];
            await attendanceService.recordManual({
                userId: req.userId,
                date: dateStr,
                checkInTime: req.requestedCheckIn,
                checkOutTime: req.requestedCheckOut || "",
                timezone: req.timezone,
                notes: `Regularized: ${req.reason}`,
            });
        }

        const updated = await db.attendanceRegularization.findUnique({ where: { id } });

        emitToUser(req.userId, "regularization:reviewed", {
            requestId: id, status: newStatus, reviewNote: reviewNote || null,
        });

        return updated;
    },

    async list({ userId, status, page = 1, limit = 20 }) {
        const where = {};
        if (userId) where.userId = userId;
        if (status && status !== "all") where.status = status;

        const [requests, total] = await Promise.all([
            db.attendanceRegularization.findMany({
                where,
                include: {
                    employee: { select: { id: true, name: true, department: true, avatarUrl: true } },
                    reviewedBy: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.attendanceRegularization.count({ where }),
        ]);

        return {
            requests: requests.map(r => ({ ...r, date: r.date.toISOString().split("T")[0] })),
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    },
};

module.exports = { regularizationService };