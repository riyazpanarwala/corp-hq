// src/services/attendanceService.js
const { db }           = require("../lib/db");
const { ApiError }     = require("../lib/auth");
const { emitToAdmins } = require("../lib/socket");

const attendanceService = {
  // ── helpers ────────────────────────────────────────────────
  todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },

  async getConfig() {
    const cfg = await db.attendanceConfig.findFirst();
    if (!cfg) throw new ApiError("Attendance config not found", 500);
    return cfg;
  },

  computeLate(now, cfg) {
    const threshold = new Date(now);
    threshold.setHours(
      cfg.workStartHour,
      cfg.workStartMinute + cfg.lateThresholdMin,
      0,
      0,
    );
    const isLate      = now > threshold;
    const lateMinutes = isLate
      ? Math.floor((now.getTime() - threshold.getTime()) / 60_000)
      : 0;
    return { isLate, lateMinutes };
  },

  // ── checkIn ────────────────────────────────────────────────
  async checkIn(userId, { timezone, notes }) {
    const today  = this.todayDate();
    const cfg    = await this.getConfig();
    const exists = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (exists)
      throw new ApiError("Already checked in today", 409, "DUPLICATE_CHECKIN");

    const now                    = new Date();
    const { isLate, lateMinutes } = this.computeLate(now, cfg);

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

  // ── checkOut ───────────────────────────────────────────────
  async checkOut(userId, { timezone, notes }) {
    const today  = this.todayDate();
    const cfg    = await this.getConfig();
    const record = await db.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!record)         throw new ApiError("No check-in found for today", 404);
    if (record.checkOut) throw new ApiError("Already checked out", 409, "DUPLICATE_CHECKOUT");

    const now          = new Date();
    const hoursWorked  = (now.getTime() - record.checkIn.getTime()) / 3_600_000;
    const isHalfDay    = hoursWorked < Number(cfg.halfDayHours);

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

  // ── getTodayRecord ─────────────────────────────────────────
  async getTodayRecord(userId) {
    return db.attendance.findUnique({
      where: { userId_date: { userId, date: this.todayDate() } },
    });
  },

  // ── list ───────────────────────────────────────────────────
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

  // ── autoCheckoutOverdue ────────────────────────────────────
  async autoCheckoutOverdue() {
    const cfg    = await this.getConfig();
    const now    = new Date();
    const cutoff = new Date(now.getTime() - cfg.autoCheckoutHours * 3_600_000);

    // Explicitly bound the query to today only.  Previously the date
    // filter came from todayDate() but the cutoff could reach into
    // yesterday when autoCheckoutHours is large (e.g. 10h) and the cron
    // runs just after midnight.  Using a tight [startOfDay, now] range
    // ensures we never touch records from a different calendar day.
    const startOfToday = this.todayDate(); // midnight today

    const overdue = await db.attendance.findMany({
      where: {
        checkOut: null,
        checkIn:  { gte: startOfToday, lte: cutoff },
        date:     { gte: startOfToday, lte: now },
      },
    });

    let count = 0;
    for (const rec of overdue) {
      const checkOut    = new Date(rec.checkIn.getTime() + cfg.autoCheckoutHours * 3_600_000);
      const hoursWorked = cfg.autoCheckoutHours;

      await db.attendance
        .update({
          where: { id: rec.id },
          data:  {
            checkOut,
            hoursWorked,
            autoCheckedOut: true,
            isHalfDay:      Number(hoursWorked) < Number(cfg.halfDayHours),
            status:         "PRESENT",
          },
        })
        .catch((e) =>
          // Log instead of silently swallowing so ops can spot problems
          console.error(`[autoCheckout] Failed to update record ${rec.id}:`, e.message),
        );
      count++;
    }
    return count;
  },

  // ── monthlySummary ─────────────────────────────────────────
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
      byUser[r.userId].totalHours += Number(r.hoursWorked || 0);
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
