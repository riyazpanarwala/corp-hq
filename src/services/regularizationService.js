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

        // FIX (CodeRabbit #9 — race condition): the findFirst() check above is
        // not atomic — two concurrent requests can both pass it before either
        // insert commits. A partial unique index
        // (attendance_regularizations_user_date_pending_key, see the new
        // migration) now enforces this at the DB level. Catch the resulting
        // unique-constraint violation (Postgres 23505 → Prisma P2002) and map
        // it back to the same 409 the findFirst() check already returns.
        let req;
        try {
            req = await db.attendanceRegularization.create({
                data: {
                    userId, date: workDate,
                    requestedCheckIn: checkInTime,
                    requestedCheckOut: checkOutTime || null,
                    timezone, reason, status: "PENDING",
                },
                include: { employee: { select: { id: true, name: true, department: true } } },
            });
        } catch (err) {
            if (err.code === "P2002") {
                throw new ApiError("A pending regularization request already exists for this date", 409, "DUPLICATE_REQUEST");
            }
            throw err;
        }

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

        const result = await db.attendanceRegularization.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "REJECTED", reviewNote: "Cancelled by employee", reviewedAt: new Date() },
        });
        if (result.count === 0) throw new ApiError("Only pending requests can be cancelled", 409);
    },

    // FIX (CodeRabbit #9 — non-atomic approval, CRITICAL): previously the
    // status flip (updateMany) committed on its own, then recordManual() ran
    // afterward outside any transaction. If recordManual() threw, the request
    // was left permanently "APPROVED" with no attendance correction applied,
    // and a retry would fail with "already reviewed" since the status was
    // already flipped. Both writes are now inside one $transaction — if
    // recordManual() fails, the status flip rolls back too, so the request
    // stays PENDING and can be retried. recordManual() is passed the
    // transaction's Prisma client (tx) so its upsert participates in the
    // same transaction instead of using the module-level `db`.
    async review(id, adminId, { action, reviewNote }) {
        const req = await db.attendanceRegularization.findUnique({
            where: { id },
            include: { employee: { select: { id: true, name: true } } },
        });
        if (!req) throw new ApiError("Request not found", 404);

        const newStatus = action === "APPROVED" ? "APPROVED" : "REJECTED";

        const updated = await db.$transaction(async (tx) => {
            const result = await tx.attendanceRegularization.updateMany({
                where: { id, status: "PENDING" },
                data: { status: newStatus, reviewedById: adminId, reviewedAt: new Date(), reviewNote: reviewNote || null },
            });
            if (result.count === 0) {
                throw new ApiError("This request has already been reviewed", 409);
            }

            if (action === "APPROVED") {
                const dateStr = req.date.toISOString().split("T")[0];
                await attendanceService.recordManual({
                    userId: req.userId,
                    date: dateStr,
                    checkInTime: req.requestedCheckIn,
                    checkOutTime: req.requestedCheckOut || "",
                    timezone: req.timezone,
                    notes: `Regularized: ${req.reason}`,
                }, tx);
            }

            return tx.attendanceRegularization.findUnique({ where: { id } });
        }, { maxWait: 10_000, timeout: 30_000 });

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