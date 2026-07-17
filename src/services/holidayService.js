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

    // FIX (CodeRabbit #9 — department typos silently create orphan holidays):
    // department is now checked against actual active employee departments
    // server-side. A holiday scoped to "Enginering" (typo) previously saved
    // successfully and just never matched anyone in the dashboard's
    // isHolidayForEmp() equality check.
    //
    // FIX (CodeRabbit #9 — race condition): the findFirst() duplicate check
    // is not atomic. A partial unique index (see new migration) now backs
    // this at the DB level; the create() unique-violation is caught and
    // mapped to the same 409 the findFirst() check already returns.
    async create({ date, name, description, department }) {
        const dateOnly = toDateOnly(date);

        if (department) {
            const deptExists = await db.user.findFirst({
                where: { department, isActive: true },
                select: { id: true },
            });
            if (!deptExists) {
                throw new ApiError(`Unknown department "${department}"`, 422, "UNKNOWN_DEPARTMENT");
            }
        }

        const existing = await db.holiday.findFirst({
            where: { date: dateOnly, department: department || null },
        });
        if (existing) throw new ApiError("A holiday already exists on this date for this scope", 409);

        try {
            const holiday = await db.holiday.create({
                data: { date: dateOnly, name, description, department: department || null },
            });
            return { ...holiday, date: toDateStr(holiday.date) };
        } catch (err) {
            if (err.code === "P2002") {
                throw new ApiError("A holiday already exists on this date for this scope", 409);
            }
            throw err;
        }
    },

    async remove(id) {
        const holiday = await db.holiday.findUnique({ where: { id } });
        if (!holiday) throw new ApiError("Holiday not found", 404);
        await db.holiday.delete({ where: { id } });
    },

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

    async countWorkingHolidaysInRange(startStr, endStr, department) {
        const dateSet = await this.getHolidayDateSet(startStr, endStr, department);
        let count = 0;
        for (const d of dateSet) if (isWorkingDay(d)) count++;
        return count;
    },

    // FIX (CodeRabbit #9 — free-text department input): powers the new
    // department <select> on the Admin Holidays page so admins pick from
    // real departments instead of typing them.
    async listDepartments() {
        const rows = await db.user.findMany({
            where: { isActive: true, department: { not: null } },
            select: { department: true },
            distinct: ["department"],
            orderBy: { department: "asc" },
        });
        return rows.map(r => r.department).filter(Boolean);
    },
};

module.exports = { holidayService };