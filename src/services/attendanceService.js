// src/services/attendanceService.js
const { db }           = require("../lib/db");
const { ApiError }     = require("../lib/auth");
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
    const thresholdHour    = cfg.workStartHour + Math.floor(thresholdMinutes / 60);
    const thresholdMinute  = thresholdMinutes % 60;
    const threshold = zonedDateTimeToUtc(
      date,
      `${String(thresholdHour).padStart(2, "0")}:${String(thresholdMinute).padStart(2, "0")}`,
      timeZone,
    );
    const isLate      = now > threshold;
    const lateMinutes = isLate ? Math.floor((now.getTime() - threshold.getTime()) / 60_000) : 0;
    return { isLate, lateMinutes };
  },

  async checkIn(userId, { timezone, notes }) {
    const today  = this.todayDate(timezone);
    const cfg    = await this.getConfig();
    const exists = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (exists) throw new ApiError("Already checked in today", 409, "DUPLICATE_CHECKIN");

    const now                     = new Date();
    const { isLate, lateMinutes } = this.computeLate(now, cfg, timezone);

    const record = await db.attendance.create({
      data: {
        userId, date: today, checkIn: now, checkInTz: timezone,
        isLate, lateMinutes, status: "PRESENT", notes,
      },
      include: { user: { select: { id: true, name: true, department: true } } },
    });

    emitToAdmins("attendance:checkin", {
      userId,
      userName:   record.user.name,
      department: record.user.department,
      checkIn:    record.checkIn,
      isLate,
      lateMinutes,
    });

    return record;
  },

  async checkOut(userId, { timezone, notes }) {
    const today  = this.todayDate(timezone);
    const cfg    = await this.getConfig();
    const record = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!record)         throw new ApiError("No check-in found for today", 404);
    if (record.checkOut) throw new ApiError("Already checked out", 409, "DUPLICATE_CHECKOUT");

    const now         = new Date();
    const hoursWorked = (now.getTime() - record.checkIn.getTime()) / 3_600_000;
    const isHalfDay   = hoursWorked < toFloat(cfg.halfDayHours);

    const updated = await db.attendance.update({
      where: { userId_date: { userId, date: today } },
      data:  {
        checkOut:    now,
        checkOutTz:  timezone,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        isHalfDay,
        status:      isHalfDay ? "HALF_DAY" : "PRESENT",
        notes:       notes ?? record.notes,
      },
    });

    emitToAdmins("attendance:checkout", {
      userId, checkOut: now, hoursWorked: updated.hoursWorked, isHalfDay,
    });

    return updated;
  },

  // FIX (getTodayRecord — closed records): The previous version filtered by
  // `checkOut: null`, so after an employee checked out the query fell back to
  // the stored user timezone, which could differ from the checkInTz actually
  // used when the row was written.  This returned null for today's completed
  // record on the dashboard.
  //
  // New strategy: fetch the most recent attendance record regardless of
  // checkout state.  If it has a checkInTz, use that to resolve "today" and
  // look up the row.  Only fall back to the stored user timezone if there is
  // no recent record at all (brand new employee, no history).
  async getTodayRecord(userId) {
    // Most recent record for this user — open or closed
    const recent = await db.attendance.findFirst({
      where:   { userId },
      orderBy: { checkIn: "desc" },
      select:  { checkInTz: true, date: true },
    });

    if (recent?.checkInTz) {
      const today = this.todayDate(recent.checkInTz);
      return db.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });
    }

    // No attendance history — fall back to stored user timezone
    const user = await db.user.findUnique({
      where:  { id: userId },
      select: { timezone: true },
    });
    const today = this.todayDate(user?.timezone || "UTC");
    return db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
  },

  async recordManual({ userId, date, checkInTime, checkOutTime, timezone, notes }) {
    const cfg = await this.getConfig();
    const employee = await db.user.findFirst({
      where:  { id: userId, role: "EMPLOYEE", isActive: true },
      select: { id: true },
    });
    if (!employee) throw new ApiError("Employee not found", 404);

    const workDate = workDateFromString(date);
    const checkIn  = zonedDateTimeToUtc(date, checkInTime, timezone);
    const checkOut = checkOutTime ? zonedDateTimeToUtc(date, checkOutTime, timezone) : null;
    if (checkOut && checkOut <= checkIn) {
      throw new ApiError("Check out must be after check in", 422, "INVALID_CHECKOUT_TIME");
    }

    const { isLate, lateMinutes } = this.computeLate(checkIn, cfg, timezone);
    const hoursWorked = checkOut
      ? Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100
      : null;
    const isHalfDay = hoursWorked != null && hoursWorked < toFloat(cfg.halfDayHours);

    return db.attendance.upsert({
      where:  { userId_date: { userId, date: workDate } },
      update: {
        checkIn, checkOut, checkInTz: timezone,
        checkOutTz: checkOut ? timezone : null,
        hoursWorked, isLate, lateMinutes, isHalfDay,
        autoCheckedOut: false,
        status: isHalfDay ? "HALF_DAY" : "PRESENT",
        notes,
      },
      create: {
        userId, date: workDate, checkIn, checkOut,
        checkInTz: timezone, checkOutTz: checkOut ? timezone : null,
        hoursWorked, isLate, lateMinutes, isHalfDay,
        status: isHalfDay ? "HALF_DAY" : "PRESENT",
        notes,
      },
      include: { user: { select: { id: true, name: true, department: true, designation: true } } },
    });
  },

  async list({ userId, date, month, status, page = 1, limit = 50 }) {
    const where = {};
    if (userId) where.userId = userId;
    if (date)   where.date   = new Date(date);
    if (month) {
      const [y, m] = month.split("-").map(Number);
      where.date   = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }
    if (status === "late")    where.isLate    = true;
    if (status === "halfday") where.isHalfDay = true;

    const [records, total] = await Promise.all([
      db.attendance.findMany({
        where,
        include: { user: { select: { id: true, name: true, department: true, designation: true } } },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }],
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      db.attendance.count({ where }),
    ]);

    return {
      records,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  // FIX (autoCheckoutOverdue — status inconsistency): The previous code
  // hardcoded `status: "PRESENT"` in the update even when `isHalfDay` was
  // true, leaving the DB in an inconsistent state where isHalfDay=true but
  // status="PRESENT".  The status now derives from the computed isHalfDay,
  // matching the same logic used in checkOut() and recordManual().
  async autoCheckoutOverdue() {
    const cfg    = await this.getConfig();
    const now    = new Date();
    const cutoff = new Date(now.getTime() - cfg.autoCheckoutHours * 3_600_000);

    const overdue = await db.attendance.findMany({
      where: { checkOut: null, checkIn: { lte: cutoff } },
    });

    let count = 0;
    for (const rec of overdue) {
      const tz      = rec.checkInTz || "UTC";
      const today   = this.todayDate(tz);
      const recDate = rec.date instanceof Date ? rec.date : new Date(rec.date);

      // Only auto-checkout records whose stored date equals today in their TZ
      if (recDate.getTime() !== today.getTime()) continue;

      const checkOut    = new Date(rec.checkIn.getTime() + cfg.autoCheckoutHours * 3_600_000);
      const hoursWorked = cfg.autoCheckoutHours;
      const isHalfDay   = toFloat(hoursWorked) < toFloat(cfg.halfDayHours);

      await db.attendance
        .update({
          where: { id: rec.id },
          data:  {
            checkOut,
            checkOutTz:    tz,
            hoursWorked,
            autoCheckedOut: true,
            isHalfDay,
            // FIX: derive status from isHalfDay instead of hardcoding "PRESENT"
            status:        isHalfDay ? "HALF_DAY" : "PRESENT",
          },
        })
        .catch(e => console.error(`[autoCheckout] Failed to update record ${rec.id}:`, e.message));
      count++;
    }
    return count;
  },

  async monthlySummary(year, month) {
    const start = new Date(year, month - 1, 1);
    const end   = new Date(year, month, 1);
    const recs  = await db.attendance.findMany({
      where:   { date: { gte: start, lt: end } },
      include: { user: { select: { id: true, name: true, department: true } } },
    });

    const byUser = {};
    for (const r of recs) {
      if (!byUser[r.userId]) {
        byUser[r.userId] = { ...r.user, present: 0, late: 0, halfDay: 0, totalHours: 0 };
      }
      byUser[r.userId].present++;
      if (r.isLate)    byUser[r.userId].late++;
      if (r.isHalfDay) byUser[r.userId].halfDay++;
      byUser[r.userId].totalHours += toFloat(r.hoursWorked);
    }

    return Object.values(byUser).map(e => ({
      ...e,
      totalHours: Math.round(e.totalHours * 10) / 10,
      avgHours:   e.present ? Math.round((e.totalHours / e.present) * 10) / 10 : 0,
    }));
  },
};

module.exports = { attendanceService };
