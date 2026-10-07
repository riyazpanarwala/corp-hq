// src/services/attendanceService.js
const { db } = require("../lib/db");
const { ApiError } = require("../lib/auth");
const { emitToAdmins } = require("../lib/socket");

/**
 * Converts a date string, time string, and timezone to a UTC Date object.
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} time - Time in HH:mm format
 * @param {string} timeZone - IANA timezone identifier
 * @returns {Date} UTC Date representation
 */
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

/**
 * Formats a Date object as a YYYY-MM-DD string in the specified timezone.
 *
 * @param {Date} date - Date to format
 * @param {string} timeZone - IANA timezone identifier
 * @returns {string} Date string in YYYY-MM-DD format
 */
function dateStringInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Parses a YYYY-MM-DD date string into a UTC midnight Date.
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Date} UTC midnight Date
 */
function workDateFromString(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * Safely converts Decimal or numeric values to a floating-point number.
 *
 * @param {any} val - Decimal object, string, or number
 * @returns {number} Floating-point numeric value
 */
function toFloat(val) {
  if (val == null) return 0;
  return parseFloat(val.toString());
}

const attendanceService = {
  /**
   * Returns today's calendar date at UTC midnight for the given timezone.
   *
   * @param {string} [timeZone="UTC"] - IANA timezone identifier
   * @returns {Date} UTC midnight Date for today
   */
  todayDate(timeZone = "UTC") {
    return workDateFromString(dateStringInZone(new Date(), timeZone));
  },

  /**
   * Retrieves the global attendance configuration.
   *
   * @returns {Promise<object>} Global attendance configuration record
   */
  async getConfig() {
    const cfg = await db.attendanceConfig.findFirst();
    if (!cfg) throw new ApiError("Attendance config not found", 500);
    return cfg;
  },

  /**
   * Evaluates if a check-in is late compared to work schedule and late threshold.
   * Compares at minute-level granularity.
   *
   * @param {Date} now - Check-in timestamp
   * @param {object} cfg - Config with workStartHour, workStartMinute, lateThresholdMin
   * @param {string} [timeZone="UTC"] - Employee timezone
   * @returns {{ isLate: boolean, lateMinutes: number }} Lateness assessment
   */
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

    const nowMinuteFloor = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const isLate = nowMinuteFloor > threshold;
    const lateMinutes = isLate
      ? Math.floor((nowMinuteFloor.getTime() - threshold.getTime()) / 60_000)
      : 0;

    return { isLate, lateMinutes };
  },

  /**
   * Record an employee check-in.
   * If no attendance record exists today, creates a new one with Session #1.
   * If attendance already exists and all sessions are closed, creates a new session.
   * Enforces atomicity via transaction and partial unique index to block duplicate open sessions.
   *
   * @param {number} userId - The user ID checking in
   * @param {object} options - Options containing timezone and optional notes
   * @returns {Promise<object>} The updated or newly created attendance record with sessions
   */
  async checkIn(userId, { timezone, notes }) {
    const today = this.todayDate(timezone);
    const cfg = await this.getConfig();
    const now = new Date();

    try {
      const result = await db.$transaction(async (tx) => {
        const existing = await tx.attendance.findUnique({
          where: { userId_date: { userId, date: today } },
          include: {
            sessions: { orderBy: { checkIn: "asc" } },
            user: { select: { id: true, name: true, department: true } },
          },
        });

        if (existing) {
          const openSession = existing.sessions.find(s => !s.checkOut);
          if (openSession) {
            throw new ApiError("Already checked in (session active)", 409, "DUPLICATE_CHECKIN");
          }

          const newSession = await tx.attendanceSession.create({
            data: {
              attendanceId: existing.id,
              checkIn: now,
              checkInTz: timezone,
              notes,
            },
          });

          const updatedRecord = await tx.attendance.update({
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

          return { record: updatedRecord, newSessionId: newSession.id, isResumed: true };
        }

        const { isLate, lateMinutes } = this.computeLate(now, cfg, timezone);

        const record = await tx.attendance.create({
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

        return { record, newSessionId: record.sessions[0]?.id, isResumed: false };
      }, { isolationLevel: "Serializable" });

      emitToAdmins("attendance:checkin", {
        userId,
        userName: result.record.user.name,
        department: result.record.user.department,
        checkIn: now,
        isLate: result.record.isLate,
        lateMinutes: result.record.lateMinutes,
        sessionId: result.newSessionId,
        isResumed: result.isResumed,
      });

      return result.record;
    } catch (err) {
      if (err.code === "P2002") {
        throw new ApiError("Already checked in (session active)", 409, "DUPLICATE_CHECKIN");
      }
      throw err;
    }
  },

  /**
   * Record an employee check-out.
   * Closes the active open session, recalculates total cumulative hours, and updates parent status.
   *
   * @param {number} userId - The user ID checking out
   * @param {object} options - Options containing timezone and optional notes
   * @returns {Promise<object>} The updated attendance record with sessions
   */
  async checkOut(userId, { timezone, notes }) {
    const today = this.todayDate(timezone);
    const cfg = await this.getConfig();
    const now = new Date();

    const { updated, openSessionId } = await db.$transaction(async (tx) => {
      const record = await tx.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
        include: {
          sessions: { orderBy: { checkIn: "asc" } },
          user: { select: { id: true, name: true, department: true } },
        },
      });
      if (!record) throw new ApiError("No check-in found for today", 404);

      const openSession = record.sessions.find(s => !s.checkOut);
      if (!openSession) throw new ApiError("Already checked out", 409, "DUPLICATE_CHECKOUT");

      const sessionHours = (now.getTime() - openSession.checkIn.getTime()) / 3_600_000;
      const sessionHoursRounded = Math.round(sessionHours * 100) / 100;

      await tx.attendanceSession.update({
        where: { id: openSession.id },
        data: {
          checkOut: now,
          checkOutTz: timezone,
          hoursWorked: sessionHoursRounded,
          notes: notes ?? openSession.notes,
        },
      });

      const allSessions = await tx.attendanceSession.findMany({
        where: { attendanceId: record.id },
      });
      const totalHoursWorked = allSessions.reduce((sum, s) => sum + toFloat(s.hoursWorked), 0);
      const roundedTotalHours = Math.round(totalHoursWorked * 100) / 100;
      const isHalfDay = roundedTotalHours < toFloat(cfg.halfDayHours);

      const updatedRecord = await tx.attendance.update({
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

      return { updated: updatedRecord, openSessionId: openSession.id };
    }, { isolationLevel: "Serializable" });

    emitToAdmins("attendance:checkout", {
      userId,
      checkOut: now,
      hoursWorked: updated.hoursWorked,
      isHalfDay: updated.isHalfDay,
      sessionId: openSessionId,
    });

    return updated;
  },

  /**
   * Retrieve today's attendance record for an employee, including all sessions.
   *
   * @param {number} userId - The user ID
   * @returns {Promise<object|null>} The attendance record with sessions, or null
   */
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

  /**
   * Create or update attendance manually (used by admin or regularization approval).
   * Validates that updating or creating sessions does not result in multiple open sessions.
   *
   * @param {object} params - Manual attendance parameters
   * @param {object} [client=db] - Prisma client or transaction client
   * @returns {Promise<object>} The updated attendance record
   */
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

      // Reject edit if it would leave more than one session open
      if (!checkOut) {
        const otherOpen = existing.sessions.some(s => s.id !== existingSession?.id && !s.checkOut);
        if (otherOpen) {
          throw new ApiError("Cannot leave this session open while another active session exists", 422, "MULTIPLE_OPEN_SESSIONS");
        }
      }

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

      const hasOpenSession = allSessions.some(s => !s.checkOut);
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
          checkOut: hasOpenSession ? null : lastSession.checkOut,
          checkInTz: firstSession.checkInTz,
          checkOutTz: hasOpenSession ? null : lastSession.checkOutTz,
          hoursWorked: roundedTotalHours,
          isLate,
          lateMinutes,
          isHalfDay,
          autoCheckedOut: false,
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

  /**
   * List attendance records matching filters with pagination and session details.
   *
   * @param {object} params - Filter options (userId, date, month, status, page, limit)
   * @returns {Promise<object>} Attendance records and pagination metadata
   */
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

  /**
   * Automatically check out overdue sessions that have been open beyond autoCheckoutHours.
   * Updates session and parent attendance atomically, incrementing count only on success.
   *
   * @returns {Promise<number>} Number of successfully auto-checked-out sessions
   */
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

      try {
        await db.$transaction(async (tx) => {
          await tx.attendanceSession.update({
            where: { id: session.id },
            data: {
              checkOut,
              checkOutTz: tz,
              hoursWorked: sessionHours,
            },
          });

          const allSessions = await tx.attendanceSession.findMany({
            where: { attendanceId: session.attendanceId },
          });
          const totalHoursWorked = allSessions.reduce((sum, s) => sum + toFloat(s.hoursWorked), 0);
          const roundedTotalHours = Math.round(totalHoursWorked * 100) / 100;
          const isHalfDay = roundedTotalHours < toFloat(cfg.halfDayHours);

          await tx.attendance.update({
            where: { id: session.attendanceId },
            data: {
              checkOut,
              checkOutTz: tz,
              hoursWorked: roundedTotalHours,
              autoCheckedOut: true,
              isHalfDay,
              status: isHalfDay ? "HALF_DAY" : "PRESENT",
            },
          });
        });
        count++;
      } catch (e) {
        console.error(`[autoCheckout] Failed to auto-checkout session ${session.id}:`, e.message);
      }
    }
    return count;
  },

  /**
   * Generates a monthly summary report of attendance across all users.
   *
   * @param {number} year - The full year (e.g. 2026)
   * @param {number} month - The 1-based month (1-12)
   * @returns {Promise<Array<object>>} Aggregated summary records by employee
   */
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
