// src/services/holidayService.js
const { db } = require("../lib/db");
const { ApiError } = require("../lib/auth");
const { isWorkingDay } = require("../lib/utils");

function toDateOnly(dateStr) {
    return new Date(`${dateStr}T00:00:00.000Z`);
}
function toDateStr(date) {
    return date.toISOString().split("T")[0];
}

const holidayService = {
    async list({ year } = {}) {
        const where = {};
        if (year) {
            where.date = {
                gte: new Date(Date.UTC(year, 0, 1)),
                lt: new Date(Date.UTC(year + 1, 0, 1)),
            };
        }
        const holidays = await db.holiday.findMany({ where, orderBy: { date: "asc" } });
        return holidays.map(h => ({ ...h, date: toDateStr(h.date) }));
    },

    async create({ date, name, description, department }) {
        const dateOnly = toDateOnly(date);
        const existing = await db.holiday.findFirst({
            where: { date: dateOnly, department: department || null },
        });
        if (existing) throw new ApiError("A holiday already exists on this date for this scope", 409);

        const holiday = await db.holiday.create({
            data: { date: dateOnly, name, description, department: department || null },
        });
        return { ...holiday, date: toDateStr(holiday.date) };
    },

    async remove(id) {
        const holiday = await db.holiday.findUnique({ where: { id } });
        if (!holiday) throw new ApiError("Holiday not found", 404);
        await db.holiday.delete({ where: { id } });
    },

    // Returns a Set of "YYYY-MM-DD" holiday dates within [startStr, endStr]
    // (inclusive) that are scoped to "all departments" (department: null) or
    // the given department. Single query, reused by both the range-subtract
    // logic in apply() and the explicit-date-rejection logic in recordPast().
    async getHolidayDateSet(startStr, endStr, department) {
        const rows = await db.holiday.findMany({
            where: {
                date: { gte: toDateOnly(startStr), lte: toDateOnly(endStr) },
                OR: [{ department: null }, ...(department ? [{ department }] : [])],
            },
            select: { date: true },
        });
        return new Set(rows.map(r => toDateStr(r.date)));
    },

    // Counts holiday dates within the range that fall on what would otherwise
    // be a working day (weekday, or the month's one working Saturday). Used by
    // leaveService so leave balance isn't double-charged for a day that's
    // already a public holiday.
    async countWorkingHolidaysInRange(startStr, endStr, department) {
        const dateSet = await this.getHolidayDateSet(startStr, endStr, department);
        let count = 0;
        for (const d of dateSet) if (isWorkingDay(d)) count++;
        return count;
    },
};

module.exports = { holidayService };