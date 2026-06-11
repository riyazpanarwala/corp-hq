// src/services/leaveService.js
const { db }                       = require("../lib/db");
const { ApiError }                 = require("../lib/auth");
const { emitToAdmins, emitToUser } = require("../lib/socket");
const { countWorkingDays, isWorkingDay } = require("../lib/utils");

const COLS = {
  CL: { total: "clTotal", used: "clUsed", pending: "clPending" },
  SL: { total: "slTotal", used: "slUsed", pending: "slPending" },
  PL: { total: "plTotal", used: "plUsed", pending: "plPending" },
};

// Resolve "today" in a given timezone using Intl — same logic as validations.js
function todayInZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

const leaveService = {
  async apply(userId, { type, startDate, endDate, reason }) {
    const days = countWorkingDays(startDate, endDate);
    if (days === 0) throw new ApiError("No working days in selected range");

    const leave = await db.$transaction(async (tx) => {
      // Lock the balance row for the duration of this transaction to prevent
      // concurrent requests from both passing the availability check.
      const rows = await tx.$queryRaw`
        SELECT id,
               cl_total, cl_used, cl_pending,
               sl_total, sl_used, sl_pending,
               pl_total, pl_used, pl_pending
        FROM leave_balances
        WHERE user_id = ${userId}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) throw new ApiError("Leave balance not found", 404);

      const prefix    = type.toLowerCase();
      const bal       = rows[0];
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
        data: { userId, type, startDate: start, endDate: end, days, reason, status: "PENDING" },
        include: { employee: { select: { id: true, name: true, department: true } } },
      });

      await tx.leaveBalance.update({
        where: { userId },
        data:  { [COLS[type].pending]: { increment: days } },
      });

      return req;
    });

    emitToAdmins("leave:applied", {
      leaveId: leave.id, userId, userName: leave.employee.name,
      type, days, startDate, endDate,
    });

    return leave;
  },

  async recordPast(adminId, { userId, type, dates, reason }) {
    const sortedDates = [...dates].sort();
    const nonWorkingDate = sortedDates.find(date => !isWorkingDay(date));
    if (nonWorkingDate) throw new ApiError(`${nonWorkingDate} is not a working day`, 422);
    const days = sortedDates.length;

    const employee = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, department: true, timezone: true, isActive: true, role: true },
    });
    if (!employee || !employee.isActive || employee.role !== "EMPLOYEE") {
      throw new ApiError("Employee not found", 404);
    }

    const today = todayInZone(employee.timezone || "UTC");
    if (sortedDates.some(date => date > today)) {
      throw new ApiError("Past leave dates cannot be after today", 422);
    }

    const leaves = await db.$transaction(async (tx) => {
      await tx.leaveBalance.upsert({
        where: { userId },
        update: {},
        create: { userId, year: Number(sortedDates[0].slice(0, 4)) },
      });

      const rows = await tx.$queryRaw`
        SELECT id, year,
               cl_total, cl_used, cl_pending,
               sl_total, sl_used, sl_pending,
               pl_total, pl_used, pl_pending
        FROM leave_balances
        WHERE user_id = ${userId}
        FOR UPDATE
      `;
      if (!rows || rows.length === 0) throw new ApiError("Leave balance not found", 404);

      const balance = rows[0];
      if (sortedDates.some(date => Number(balance.year) !== Number(date.slice(0, 4)))) {
        throw new ApiError(`Past leave must be within leave balance year ${balance.year}`, 422);
      }

      const prefix = type.toLowerCase();
      const available = Number(balance[`${prefix}_total`])
        - Number(balance[`${prefix}_used`])
        - Number(balance[`${prefix}_pending`]);
      if (days > available) {
        throw new ApiError(
          `Insufficient ${type} balance. Available: ${available}, Requested: ${days}`,
          422,
          "INSUFFICIENT_BALANCE",
        );
      }

      const overlap = await tx.leaveRequest.findFirst({
        where: {
          userId,
          status: { in: ["PENDING", "APPROVED"] },
          OR: sortedDates.map(date => {
            const value = new Date(date);
            return { startDate: { lte: value }, endDate: { gte: value } };
          }),
        },
      });
      if (overlap) throw new ApiError("Overlapping leave request exists", 409, "OVERLAP");

      const reviewedAt = new Date();
      const created = await tx.leaveRequest.createManyAndReturn({
        data: sortedDates.map(date => {
          const value = new Date(date);
          return {
            userId, type, startDate: value, endDate: value, days: 1, reason,
            status: "APPROVED", reviewedById: adminId, reviewedAt,
            reviewNote: "Recorded by admin as past leave",
          };
        }),
      });

      await tx.leaveBalance.update({
        where: { userId },
        data: { [COLS[type].used]: { increment: days } },
      });
      return created;
    }, {
      maxWait: 10_000,
      timeout: 30_000,
    });

    for (const leave of leaves) {
      emitToUser(userId, "leave:reviewed", {
        leaveId: leave.id, status: "APPROVED", reviewNote: leave.reviewNote,
      });
    }
    return leaves;
  },

  // FIX (review race condition): Previously, leave.status was checked OUTSIDE
  // the transaction.  Two concurrent approve/reject requests could both pass
  // that check and then both mutate leave_balances, double-decrementing
  // `pending` or double-incrementing `used`.
  //
  // New approach: use updateMany with a WHERE status="PENDING" guard as the
  // very first write inside the transaction.  If count === 0, another request
  // already flipped the status — we throw immediately without touching balances.
  // This is a conditional update pattern that makes the status transition
  // and balance mutation atomic.
  async review(leaveId, adminId, { action, reviewNote }) {
    // Fetch metadata (type, userId, days) for balance updates — read-only,
    // outside the transaction is fine since we gate on status inside.
    const leave = await db.leaveRequest.findUnique({
      where:   { id: leaveId },
      include: { employee: { select: { id: true, name: true } } },
    });
    if (!leave) throw new ApiError("Leave not found", 404);

    const cols      = COLS[leave.type];
    const newStatus = action === "APPROVED" ? "APPROVED" : "REJECTED";

    const updated = await db.$transaction(async (tx) => {
      // Atomic conditional update — only succeeds if status is still PENDING
      const result = await tx.leaveRequest.updateMany({
        where: { id: leaveId, status: "PENDING" },
        data:  {
          status:       newStatus,
          reviewedById: adminId,
          reviewedAt:   new Date(),
          reviewNote:   reviewNote || null,
        },
      });

      // count === 0 means another request already processed this leave
      if (result.count === 0) {
        throw new ApiError("Leave has already been reviewed", 409);
      }

      // Balance update only runs if the status flip succeeded
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

      // Return the updated record for the response
      return tx.leaveRequest.findUnique({ where: { id: leaveId } });
    });

    emitToUser(leave.userId, "leave:reviewed", {
      leaveId, status: newStatus, reviewNote: reviewNote || null,
    });
    return updated;
  },

  // FIX (cancel race condition + timezone mismatch):
  //
  // 1. Race condition: same as review() — status check was outside the
  //    transaction.  Now uses updateMany with WHERE status IN ("PENDING") as
  //    an atomic gate before touching the balance.
  //
  // 2. Timezone mismatch: todayDateStr() used server-local time, while
  //    leave.startDate.toISOString() is UTC.  Around midnight this could make
  //    a leave non-cancellable a day early or late for employees in non-server
  //    timezones.  We now fetch the employee's stored timezone and resolve
  //    "today" in that zone using todayInZone() — same logic used when applying.
  async cancel(leaveId, userId) {
    const leave = await db.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave)                  throw new ApiError("Leave not found", 404);
    if (leave.userId !== userId) throw new ApiError("Unauthorized", 403);
    if (leave.status === "APPROVED")
      throw new ApiError("Cannot cancel approved leave. Contact HR.", 409);
    if (leave.status === "CANCELLED")
      throw new ApiError("Already cancelled", 409);

    // Resolve "today" in the employee's own timezone to avoid midnight edge cases
    const employee = await db.user.findUnique({
      where:  { id: userId },
      select: { timezone: true },
    });
    const today      = todayInZone(employee?.timezone || "UTC");
    const leaveStart = leave.startDate.toISOString().split("T")[0];

    if (leaveStart <= today) {
      throw new ApiError(
        "Cannot cancel a leave that has already started. Please contact HR.",
        409,
        "LEAVE_ALREADY_STARTED",
      );
    }

    const cols = COLS[leave.type];

    await db.$transaction(async (tx) => {
      // Atomic conditional update — only succeeds if status is still PENDING
      const result = await tx.leaveRequest.updateMany({
        where: { id: leaveId, status: "PENDING" },
        data:  { status: "CANCELLED", cancelledAt: new Date() },
      });

      if (result.count === 0) {
        throw new ApiError("Leave has already been reviewed or cancelled", 409);
      }

      await tx.leaveBalance.update({
        where: { userId },
        data:  { [cols.pending]: { decrement: leave.days } },
      });
    });
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
