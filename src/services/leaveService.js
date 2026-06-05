// src/services/leaveService.js
const { db }                       = require("../lib/db");
const { ApiError }                 = require("../lib/auth");
const { emitToAdmins, emitToUser } = require("../lib/socket");
const { countWorkingDays }         = require("../lib/utils");

const COLS = {
  CL: { total: "clTotal", used: "clUsed", pending: "clPending" },
  SL: { total: "slTotal", used: "slUsed", pending: "slPending" },
  PL: { total: "plTotal", used: "plUsed", pending: "plPending" },
};

function todayDateStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const leaveService = {
  async apply(userId, { type, startDate, endDate, reason }) {
    const days = countWorkingDays(startDate, endDate);
    if (days === 0) throw new ApiError("No working days in selected range");

    // FIX (race condition): The original code read the balance BEFORE the
    // transaction, then used the stale snapshot in an optimistic-lock WHERE
    // clause inside the transaction.  The condition was:
    //
    //   pending <= total - used - days
    //
    // …which is weaker than required: two concurrent requests for N days each
    // against an available balance of N could both pass the check because each
    // sees the pre-increment value of `pending`.
    //
    // New approach: re-read and lock the balance ROW inside the transaction
    // using a raw SELECT … FOR UPDATE, then perform the availability check
    // against the locked, current values before writing.  Any concurrent
    // transaction will block on the FOR UPDATE until we commit, eliminating
    // the race entirely.
    //
    // Prisma doesn't expose SELECT FOR UPDATE via its fluent API, so we use
    // $queryRaw.  The result is a plain object array — map it manually.
    const leave = await db.$transaction(async (tx) => {
      // Lock the row for the duration of this transaction.
      // We select all balance columns in a single FOR UPDATE query so we can
      // read the live values under the lock without a separate Prisma call.
      // $queryRaw only supports primitive interpolations, so we select all
      // columns and pick the right ones by type below.
      const rows = await tx.$queryRaw`
        SELECT id,
               cl_total, cl_used, cl_pending,
               sl_total, sl_used, sl_pending,
               pl_total, pl_used, pl_pending
        FROM leave_balances
        WHERE user_id = ${userId}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new ApiError("Leave balance not found", 404);
      }

      const cols  = COLS[type];
      const bal   = rows[0];
      // Prisma raw results use snake_case DB column names;
      // the type key is e.g. "CL" → prefix "cl"
      const prefix    = type.toLowerCase();
      const dbTotal   = Number(bal[`${prefix}_total`]);
      const dbUsed    = Number(bal[`${prefix}_used`]);
      const dbPending = Number(bal[`${prefix}_pending`]);
      const avail     = dbTotal - dbUsed - dbPending;

      if (days > avail) {
        throw new ApiError(
          `Insufficient ${type} balance. Available: ${avail}, Requested: ${days}`,
          422,
          "INSUFFICIENT_BALANCE",
        );
      }

      const start   = new Date(startDate);
      const end     = new Date(endDate);
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          userId,
          status:    { in: ["PENDING", "APPROVED"] },
          startDate: { lte: end },
          endDate:   { gte: start },
        },
      });
      if (overlap) throw new ApiError("Overlapping leave request exists", 409, "OVERLAP");

      const req = await tx.leaveRequest.create({
        data: {
          userId,
          type,
          startDate: start,
          endDate:   end,
          days,
          reason,
          status: "PENDING",
        },
        include: {
          employee: { select: { id: true, name: true, department: true } },
        },
      });

      // Increment pending using a direct UPDATE — safe because the row is locked
      await tx.leaveBalance.update({
        where: { userId },
        data:  { [cols.pending]: { increment: days } },
      });

      return req;
    });

    emitToAdmins("leave:applied", {
      leaveId:   leave.id,
      userId,
      userName:  leave.employee.name,
      type,
      days,
      startDate,
      endDate,
    });

    return leave;
  },

  async review(leaveId, adminId, { action, reviewNote }) {
    const leave = await db.leaveRequest.findUnique({
      where:   { id: leaveId },
      include: { employee: { select: { id: true, name: true } } },
    });
    if (!leave) throw new ApiError("Leave not found", 404);
    if (leave.status !== "PENDING") throw new ApiError("Leave already reviewed", 409);

    const cols      = COLS[leave.type];
    const newStatus = action === "APPROVED" ? "APPROVED" : "REJECTED";

    const updated = await db.$transaction(async (tx) => {
      const req = await tx.leaveRequest.update({
        where: { id: leaveId },
        data:  {
          status:       newStatus,
          reviewedById: adminId,
          reviewedAt:   new Date(),
          reviewNote:   reviewNote || null,
        },
      });

      if (action === "APPROVED") {
        await tx.leaveBalance.update({
          where: { userId: leave.userId },
          data:  {
            [cols.pending]: { decrement: leave.days },
            [cols.used]:    { increment: leave.days },
          },
        });
      } else {
        await tx.leaveBalance.update({
          where: { userId: leave.userId },
          data:  { [cols.pending]: { decrement: leave.days } },
        });
      }
      return req;
    });

    emitToUser(leave.userId, "leave:reviewed", {
      leaveId,
      status:     newStatus,
      reviewNote: reviewNote || null,
    });
    return updated;
  },

  async cancel(leaveId, userId) {
    const leave = await db.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave)                  throw new ApiError("Leave not found", 404);
    if (leave.userId !== userId) throw new ApiError("Unauthorized", 403);
    if (leave.status === "APPROVED")
      throw new ApiError("Cannot cancel approved leave. Contact HR.", 409);
    if (leave.status === "CANCELLED")
      throw new ApiError("Already cancelled", 409);

    const today      = todayDateStr();
    const leaveStart = leave.startDate.toISOString().split("T")[0];
    if (leaveStart <= today) {
      throw new ApiError(
        "Cannot cancel a leave that has already started. Please contact HR.",
        409,
        "LEAVE_ALREADY_STARTED",
      );
    }

    const cols = COLS[leave.type];
    await db.$transaction([
      db.leaveRequest.update({
        where: { id: leaveId },
        data:  { status: "CANCELLED", cancelledAt: new Date() },
      }),
      db.leaveBalance.update({
        where: { userId },
        data:  { [cols.pending]: { decrement: leave.days } },
      }),
    ]);
  },

  async list({ userId, status, page = 1, limit = 20 }) {
    const where = {};
    if (userId) where.userId = userId;
    if (status && status !== "all") where.status = status;

    const [leaves, total] = await Promise.all([
      db.leaveRequest.findMany({
        where,
        include: {
          employee:   { select: { id: true, name: true, department: true, avatarUrl: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { appliedOn: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      db.leaveRequest.count({ where }),
    ]);

    return {
      leaves,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  async getBalance(userId) {
    return db.leaveBalance.findUnique({ where: { userId } });
  },
};

module.exports = { leaveService };
