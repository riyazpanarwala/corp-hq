// src/services/attendanceService.js
const { db } = require("../lib/db");
const { ApiError } = require("../lib/auth");
const { emitToAdmins } = require("../lib/socket");

function zonedDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const offsetAt = (utcMs) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    return asUtc - utcMs;
  };

  const firstPass = utcGuess - offsetAt(utcGuess);
  return new Date(utcGuess - offsetAt(firstPass));
}

function dateStringInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function workDateFromString(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

// FIX (hoursWorked): Prisma returns Decimal objects for Decimal columns.
// Always use parseFloat() so both Decimal objects and plain JS numbers work.
function toFloat(val) {
  if (val == null) return 0;
  return parseFloat(val.toString());
}

const attendanceService = {
  todayDate(timeZone = "UTC") {
    return workDateFromString(dateStringInZone(new Date(), timeZone));
  },

  async getConfig() {
    const cfg = await db.attendanceConfig.findFirst();
    if (!cfg) throw new ApiError("Attendance config not found", 500);
    return cfg;
  },

  computeLate(now, cfg, timeZone = "UTC") {
    const date = dateStringInZone(now, timeZone);

    const thresholdMinutes = cfg.workStartMinute + cfg.lateThresholdMin;
    const thresholdHour = cfg.workStartHour + Math.floor(thresholdMinutes / 60);
    const thresholdMinute = thresholdMinutes % 60;
    const threshold = zonedDateTimeToUtc(
      date,
      `${String(thresholdHour).padStart(2, "0")}:${String(thresholdMinute).padStart(2, "0")}`,
      timeZone,
    );

    // FIX: compare at minute-level granularity, not to the exact second.
    // Previously `now > threshold` used the raw timestamp, so checking in at
    // 09:30:07 (which the UI displays as just "09:30 AM") already counted as
    // late — even though from the employee's perspective they checked in
    // exactly at the grace-period cutoff. Flooring both sides to the minute
    // means the whole 09:30 minute counts as "on time", matching what's
    // actually shown on screen. Anything from 09:31:00 onward is late.
    const nowMinuteFloor = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const isLate = nowMinuteFloor > threshold;
    const lateMinutes = isLate
      ? Math.floor((nowMinuteFloor.getTime() - threshold.getTime()) / 60_000)
      : 0;

    return { isLate, lateMinutes };
  },

  async checkIn(userId, { timezone, notes }) {
    const today = this.todayDate(timezone);
    const cfg = await this.getConfig();
    const existing = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        sessions: { orderBy: { checkIn: "asc" } },
        user: { select: { id: true, name: true, department: true } },
      },
    });

    const now = new Date();

    if (existing) {
      // Check if an existing session is still in progress (not checked out)
      const openSession = existing.sessions.find(s => !s.checkOut);
      if (openSession) {
        throw new ApiError("Already checked in (session active)", 409, "DUPLICATE_CHECKIN");
      }

      // Start an additional session (e.g. Session 2, Session 3)
      const newSession = await db.attendanceSession.create({
        data: {
          attendanceId: existing.id,
          checkIn: now,
          checkInTz: timezone,
          notes,
        },
      });

      // Update parent attendance: active again (checkOut cleared), keep first checkIn and late status
      const updatedRecord = await db.attendance.update({
        where: { id: existing.id },
        data: {
          checkOut: null,
          checkOutTz: null,
          autoCheckedOut: false,
        },
        include: {
          user: { select: { id: true, name: true, department: true } },
          sessions: { orderBy: { checkIn: "asc" } },
        },
      });

      emitToAdmins("attendance:checkin", {
        userId,
        userName: updatedRecord.user.name,
        department: updatedRecord.user.department,
        checkIn: now,
        isLate: updatedRecord.isLate,
        lateMinutes: updatedRecord.lateMinutes,
        sessionId: newSession.id,
        isResumed: true,
      });

      return updatedRecord;
    }

    // First check-in of the day
    const { isLate, lateMinutes } = this.computeLate(now, cfg, timezone);

    const record = await db.attendance.create({
      data: {
        userId,
        date: today,
        checkIn: now,
        checkInTz: timezone,
        isLate,
        lateMinutes,
        status: "PRESENT",
        notes,
        sessions: {
          create: {
            checkIn: now,
            checkInTz: timezone,
            notes,
          },
        },
      },
      include: {
        user: { select: { id: true, name: true, department: true } },
        sessions: { orderBy: { checkIn: "asc" } },
      },
    });

    emitToAdmins("attendance:checkin", {
      userId,
      userName: record.user.name,
      department: record.user.department,
      checkIn: record.checkIn,
      isLate,
      lateMinutes,
      sessionId: record.sessions[0]?.id,
      isResumed: false,
    });

    return record;
  },

  async checkOut(userId, { timezone, notes }) {
    const today = this.todayDate(timezone);
    const cfg = await this.getConfig();
    const record = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        sessions: { orderBy: { checkIn: "asc" } },
        user: { select: { id: true, name: true, department: true } },
      },
    });
    if (!record) throw new ApiError("No check-in found for today", 404);

    // Find the currently open session
    const openSession = record.sessions.find(s => !s.checkOut);
    if (!openSession) throw new ApiError("Already checked out", 409, "DUPLICATE_CHECKOUT");

    const now = new Date();
    const sessionHours = (now.getTime() - openSession.checkIn.getTime()) / 3_600_000;
    const sessionHoursRounded = Math.round(sessionHours * 100) / 100;

    // Close open session
    await db.attendanceSession.update({
      where: { id: openSession.id },
      data: {
        checkOut: now,
        checkOutTz: timezone,
        hoursWorked: sessionHoursRounded,
        notes: notes ?? openSession.notes,
      },
    });

    // Re-fetch all sessions to calculate cumulative hours worked
    const allSessions = await db.attendanceSession.findMany({
      where: { attendanceId: record.id },
    });
    const totalHoursWorked = allSessions.reduce((sum, s) => sum + toFloat(s.hoursWorked), 0);
    const roundedTotalHours = Math.round(totalHoursWorked * 100) / 100;
    const isHalfDay = roundedTotalHours < toFloat(cfg.halfDayHours);

    const updated = await db.attendance.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        checkOutTz: timezone,
        hoursWorked: roundedTotalHours,
        isHalfDay,
        status: isHalfDay ? "HALF_DAY" : "PRESENT",
        notes: notes ?? record.notes,
      },
      include: {
        user: { select: { id: true, name: true, department: true } },
        sessions: { orderBy: { checkIn: "asc" } },
      },
    });

    emitToAdmins("attendance:checkout", {
      userId,
      checkOut: now,
      hoursWorked: updated.hoursWorked,
      isHalfDay,
      sessionId: openSession.id,
    });

    return updated;
  },

  async getTodayRecord(userId) {
    const recent = await db.attendance.findFirst({
      where: { userId },
      orderBy: { checkIn: "desc" },
      select: { checkInTz: true, date: true },
    });

    let today;
    if (recent?.checkInTz) {
      today = this.todayDate(recent.checkInTz);
    } else {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      today = this.todayDate(user?.timezone || "UTC");
    }

    return db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { sessions: { orderBy: { checkIn: "asc" } } },
    });
  },

  async recordManual({ userId, date, checkInTime, checkOutTime, timezone, notes }, client = db) {
    const cfg = await this.getConfig();
    const employee = await client.user.findFirst({
      where: { id: userId, role: "EMPLOYEE", isActive: true },
      select: { id: true },
    });
    if (!employee) throw new ApiError("Employee not found", 404);

    const workDate = workDateFromString(date);
    const checkIn = zonedDateTimeToUtc(date, checkInTime, timezone);
    const checkOut = checkOutTime ? zonedDateTimeToUtc(date, checkOutTime, timezone) : null;
    if (checkOut && checkOut <= checkIn) {
      throw new ApiError("Check out must be after check in", 422, "INVALID_CHECKOUT_TIME");
    }

    const manualHours = checkOut
      ? Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100
      : null;

    const existing = await client.attendance.findUnique({
      where: { userId_date: { userId, date: workDate } },
      include: { sessions: { orderBy: { checkIn: "asc" } } },
    });

    if (existing && existing.sessions.length > 0) {
      const existingSession = existing.sessions.find(s => {
        return Math.abs(s.checkIn.getTime() - checkIn.getTime()) < 60_000;
      });

      if (existingSession) {
        await client.attendanceSession.update({
          where: { id: existingSession.id },
          data: {
            checkIn,
            checkOut,
            checkInTz: timezone,
            checkOutTz: checkOut ? timezone : null,
            hoursWorked: manualHours,
            notes,
          },
        });
      } else {
        await client.attendanceSession.create({
          data: {
            attendanceId: existing.id,
            checkIn,
            checkOut,
            checkInTz: timezone,
            checkOutTz: checkOut ? timezone : null,
            hoursWorked: manualHours,
            notes,
          },
        });
      }

      const allSessions = await client.attendanceSession.findMany({
        where: { attendanceId: existing.id },
        orderBy: { checkIn: "asc" },
      });

      const firstSession = allSessions[0];
      const lastSession = allSessions[allSessions.length - 1];
      const totalHours = allSessions.reduce((sum, s) => sum + toFloat(s.hoursWorked), 0);
      const roundedTotalHours = Math.round(totalHours * 100) / 100;
      const { isLate, lateMinutes } = this.computeLate(firstSession.checkIn, cfg, timezone);
      const isHalfDay = roundedTotalHours < toFloat(cfg.halfDayHours);

      return client.attendance.update({
        where: { id: existing.id },
        data: {
          checkIn: firstSession.checkIn,
          checkOut: lastSession.checkOut,
          checkInTz: firstSession.checkInTz,
          checkOutTz: lastSession.checkOutTz,
          hoursWorked: roundedTotalHours,
          isLate,
          lateMinutes,
          isHalfDay,
          status: isHalfDay ? "HALF_DAY" : "PRESENT",
          notes: notes ?? existing.notes,
        },
        include: {
          user: { select: { id: true, name: true, department: true, designation: true } },
          sessions: { orderBy: { checkIn: "asc" } },
        },
      });
    }

    const { isLate, lateMinutes } = this.computeLate(checkIn, cfg, timezone);
    const isHalfDay = manualHours != null && manualHours < toFloat(cfg.halfDayHours);

    return client.attendance.create({
      data: {
        userId,
        date: workDate,
        checkIn,
        checkOut,
        checkInTz: timezone,
        checkOutTz: checkOut ? timezone : null,
        hoursWorked: manualHours,
        isLate,
        lateMinutes,
        isHalfDay,
        status: isHalfDay ? "HALF_DAY" : "PRESENT",
        notes,
        sessions: {
          create: {
            checkIn,
            checkOut,
            checkInTz: timezone,
            checkOutTz: checkOut ? timezone : null,
            hoursWorked: manualHours,
            notes,
          },
        },
      },
      include: {
        user: { select: { id: true, name: true, department: true, designation: true } },
        sessions: { orderBy: { checkIn: "asc" } },
      },
    });
  },

  async list({ userId, userIds, date, month, status, page = 1, limit = 50 }) {
    const where = {};
    if (userId) where.userId = userId;
    else if (userIds) where.userId = { in: userIds };
    if (date) where.date = new Date(date);
    if (month) {
      const [y, m] = month.split("-").map(Number);
      where.date = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }
    if (status === "late") where.isLate = true;
    if (status === "halfday") where.isHalfDay = true;

    const [records, total] = await Promise.all([
      db.attendance.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, department: true, designation: true } },
          sessions: { orderBy: { checkIn: "asc" } },
        },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.attendance.count({ where }),
    ]);

    return {
      records,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  async autoCheckoutOverdue() {
    const cfg = await this.getConfig();
    const now = new Date();
    const cutoff = new Date(now.getTime() - cfg.autoCheckoutHours * 3_600_000);

    const overdueSessions = await db.attendanceSession.findMany({
      where: { checkOut: null, checkIn: { lte: cutoff } },
      include: { attendance: true },
    });

    let count = 0;
    for (const session of overdueSessions) {
      const tz = session.checkInTz || session.attendance.checkInTz || "UTC";
      const today = this.todayDate(tz);
      const recDate = session.attendance.date instanceof Date ? session.attendance.date : new Date(session.attendance.date);

      if (recDate.getTime() !== today.getTime()) continue;

      const checkOut = new Date(session.checkIn.getTime() + cfg.autoCheckoutHours * 3_600_000);
      const sessionHours = cfg.autoCheckoutHours;

      await db.attendanceSession.update({
        where: { id: session.id },
        data: {
          checkOut,
          checkOutTz: tz,
          hoursWorked: sessionHours,
        },
      }).catch(e => console.error(`[autoCheckout] Failed to update session ${session.id}:`, e.message));

      const allSessions = await db.attendanceSession.findMany({
        where: { attendanceId: session.attendanceId },
      });
      const totalHoursWorked = allSessions.reduce((sum, s) => sum + toFloat(s.hoursWorked), 0);
      const roundedTotalHours = Math.round(totalHoursWorked * 100) / 100;
      const isHalfDay = roundedTotalHours < toFloat(cfg.halfDayHours);

      await db.attendance.update({
        where: { id: session.attendanceId },
        data: {
          checkOut,
          checkOutTz: tz,
          hoursWorked: roundedTotalHours,
          autoCheckedOut: true,
          isHalfDay,
          status: isHalfDay ? "HALF_DAY" : "PRESENT",
        },
      }).catch(e => console.error(`[autoCheckout] Failed to update record ${session.attendanceId}:`, e.message));

      count++;
    }
    return count;
  },

  async monthlySummary(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const recs = await db.attendance.findMany({
      where: { date: { gte: start, lt: end } },
      include: { user: { select: { id: true, name: true, department: true } } },
    });

    const byUser = {};
    for (const r of recs) {
      if (!byUser[r.userId]) {
        byUser[r.userId] = { ...r.user, present: 0, late: 0, halfDay: 0, totalHours: 0 };
      }
      byUser[r.userId].present++;
      if (r.isLate) byUser[r.userId].late++;
      if (r.isHalfDay) byUser[r.userId].halfDay++;
      byUser[r.userId].totalHours += toFloat(r.hoursWorked);
    }

    return Object.values(byUser).map(e => ({
      ...e,
      totalHours: Math.round(e.totalHours * 10) / 10,
      avgHours: e.present ? Math.round((e.totalHours / e.present) * 10) / 10 : 0,
    }));
  },
};

module.exports = { attendanceService };
