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
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    return asUtc - utcMs;
  };

  const firstPass = utcGuess - offsetAt(utcGuess);
  return new Date(utcGuess - offsetAt(firstPass));
}

function dateStringInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function workDateFromString(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

// FIX (hoursWorked): Prisma returns Decimal objects for Decimal columns.
// Always use parseFloat() — not Number() or unary + — so that both Decimal
// objects (which have .toString()) and plain JS numbers round-trip correctly.
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
    const isLate      = now > threshold;
    const lateMinutes = isLate
      ? Math.floor((now.getTime() - threshold.getTime()) / 60_000)
      : 0;
    return { isLate, lateMinutes };
  },

  async checkIn(userId, { timezone, notes }) {
    const today  = this.todayDate(timezone);
    const cfg    = await this.getConfig();
    const exists = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (exists)
      throw new ApiError("Already checked in today", 409, "DUPLICATE_CHECKIN");

    const now                    = new Date();
    const { isLate, lateMinutes } = this.computeLate(now, cfg, timezone);

    const record = await db.attendance.create({
      data: {
        userId,
        date:       today,
        checkIn:    now,
        checkInTz:  timezone,
        isLate,
        lateMinutes,
        status:     "PRESENT",
        notes,
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
    // FIX (hoursWorked): use toFloat() so Decimal from DB round-trips correctly
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
      userId,
      checkOut:    now,
      hoursWorked: updated.hoursWorked,
      isHalfDay,
    });

    return updated;
  },

  // FIX (getTodayRecord TZ): The /api/attendance/today route never passed a
  // timezone, so this always fell back to the user's *stored* timezone.  If the
  // employee's stored TZ is stale or they checked in from a different device TZ,
  // the date lookup used the wrong local date and returned null ("no record").
  //
  // New strategy: look up by the timezone that was recorded at check-in time
  // (checkInTz on the most-recent open record for this user).  Only fall back to
  // the stored user TZ if there is no open record yet (i.e. the employee hasn't
  // checked in today), so we still pick the right "today" date for the WHERE.
  async getTodayRecord(userId) {
    // First, look for any open record whose checkInTz gives today's date in that zone
    const openRecord = await db.attendance.findFirst({
      where:   { userId, checkOut: null },
      orderBy: { checkIn: "desc" },
      select:  { checkInTz: true, date: true },
    });

    if (openRecord?.checkInTz) {
      // Re-derive "today" using the same TZ that was used at check-in
      const today = this.todayDate(openRecord.checkInTz);
      return db.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });
    }

    // No open record — fall back to the user's stored timezone to resolve today
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
    // FIX (hoursWorked): toFloat() guards against Decimal object comparison
    const isHalfDay = hoursWorked != null && hoursWorked < toFloat(cfg.halfDayHours);

    return db.attendance.upsert({
      where: { userId_date: { userId, date: workDate } },
      update: {
        checkIn,
        checkOut,
        checkInTz: timezone,
        checkOutTz: checkOut ? timezone : null,
        hoursWorked,
        isLate,
        lateMinutes,
        isHalfDay,
        autoCheckedOut: false,
        status: isHalfDay ? "HALF_DAY" : "PRESENT",
        notes,
      },
      create: {
        userId,
        date: workDate,
        checkIn,
        checkOut,
        checkInTz: timezone,
        checkOutTz: checkOut ? timezone : null,
        hoursWorked,
        isLate,
        lateMinutes,
        isHalfDay,
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
        include: {
          user: {
            select: {
              id: true, name: true, department: true, designation: true,
            },
          },
        },
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

  // FIX (autoCheckoutOverdue TZ): The original code called todayDate() with no
  // timezone, which always resolved to UTC midnight.  The `date` column stores
  // the employee's *local* date (derived from checkInTz at check-in time), so
  // using a UTC-based window excluded employees in UTC+ timezones (their records
  // had a later date) and double-included employees in UTC- zones.
  //
  // New approach:
  //   1. Fetch all open records that checked in more than autoCheckoutHours ago
  //      (no date filter at all — the cutoff on checkIn is sufficient).
  //   2. For each record, re-derive "today" in the employee's actual check-in
  //      timezone (checkInTz) and confirm the record belongs to today before
  //      auto-checking it out.  This prevents accidentally closing a record from
  //      a previous day if a server restart delayed the cron.
  async autoCheckoutOverdue() {
    const cfg    = await this.getConfig();
    const now    = new Date();
    // Any record checked in more than autoCheckoutHours ago and still open
    const cutoff = new Date(now.getTime() - cfg.autoCheckoutHours * 3_600_000);

    const overdue = await db.attendance.findMany({
      where: {
        checkOut: null,
        checkIn:  { lte: cutoff },
      },
    });

    let count = 0;
    for (const rec of overdue) {
      // Resolve "today" in the timezone that was used at check-in
      const tz      = rec.checkInTz || "UTC";
      const today   = this.todayDate(tz);
      const recDate = rec.date instanceof Date ? rec.date : new Date(rec.date);

      // Only auto-checkout records whose date column equals today in their TZ.
      // Records from a previous date (e.g. server was down overnight) are left
      // alone — an admin should review them manually.
      if (recDate.getTime() !== today.getTime()) continue;

      const checkOut    = new Date(rec.checkIn.getTime() + cfg.autoCheckoutHours * 3_600_000);
      const hoursWorked = cfg.autoCheckoutHours;

      await db.attendance
        .update({
          where: { id: rec.id },
          data:  {
            checkOut,
            checkOutTz:    tz,
            hoursWorked,
            autoCheckedOut: true,
            // FIX (hoursWorked): toFloat() so Decimal cfg value compares correctly
            isHalfDay:     toFloat(hoursWorked) < toFloat(cfg.halfDayHours),
            status:        "PRESENT",
          },
        })
        .catch((e) =>
          console.error(`[autoCheckout] Failed to update record ${rec.id}:`, e.message),
        );
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
      // FIX (hoursWorked): toFloat() handles Prisma Decimal objects
      byUser[r.userId].totalHours += toFloat(r.hoursWorked);
    }

    return Object.values(byUser).map((e) => ({
      ...e,
      totalHours: Math.round(e.totalHours * 10) / 10,
      avgHours:   e.present
        ? Math.round((e.totalHours / e.present) * 10) / 10
        : 0,
    }));
  },
};

module.exports = { attendanceService };
