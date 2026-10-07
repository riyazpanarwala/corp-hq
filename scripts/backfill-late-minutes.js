// scripts/backfill-late-minutes.js
//
// One-off backfill: recomputes `is_late` / `late_minutes` for existing
// attendance rows using the corrected minute-granular computeLate() logic
// (see attendanceService.js — floors the check-in timestamp to the minute
// before comparing against the late threshold, instead of comparing to the
// exact second).
//
// This does NOT touch checkIn/checkOut/hoursWorked/status — only isLate and
// lateMinutes are recalculated from the stored checkIn + checkInTz.
//
// Usage:
//   node scripts/backfill-late-minutes.js            # dry run (no writes)
//   node scripts/backfill-late-minutes.js --apply     # actually update rows
//   node scripts/backfill-late-minutes.js --apply --from=2026-01-01 --to=2026-07-17
//
// Run from the project root (needs DATABASE_URL from .env.local loaded, e.g.
// via `node -r dotenv/config scripts/backfill-late-minutes.js --apply dotenv_config_path=.env.local`).

const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

// ── Same TZ-aware helpers as attendanceService.js ──────────────────────────

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

// ── Fixed computeLate (minute-floored comparison) ──────────────────────────

/**
 * Calculates whether a check-in is late and how many late minutes have elapsed past the threshold.
 *
 * @param {Date} now - Check-in timestamp
 * @param {object} cfg - Attendance config with workStartHour, workStartMinute, lateThresholdMin
 * @param {string} [timeZone="UTC"] - Employee timezone
 * @returns {{ isLate: boolean, lateMinutes: number }} Lateness assessment
 */
function computeLate(now, cfg, timeZone = "UTC") {
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
}

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fromArg = args.find(a => a.startsWith("--from="));
const toArg = args.find(a => a.startsWith("--to="));
const fromDate = fromArg ? fromArg.split("=")[1] : null;
const toDate = toArg ? toArg.split("=")[1] : null;

/**
 * Main execution function for the late minutes backfill script.
 * Recalculates lateness for existing attendance records and optionally persists updates with --apply.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const cfg = await db.attendanceConfig.findFirst();
  if (!cfg) throw new Error("attendance_config row not found — cannot backfill without work-start settings");

  const where = { checkIn: { not: null } };
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate) where.date.gte = new Date(`${fromDate}T00:00:00.000Z`);
    if (toDate) where.date.lte = new Date(`${toDate}T00:00:00.000Z`);
  }

  const records = await db.attendance.findMany({
    where,
    select: {
      id: true, date: true, checkIn: true, checkInTz: true,
      isLate: true, lateMinutes: true,
    },
    orderBy: { date: "asc" },
  });

  console.log(`Found ${records.length} attendance record(s) with a check-in${fromDate || toDate ? " in the given range" : ""}.`);
  console.log(apply ? "Mode: APPLY (will write changes)\n" : "Mode: DRY RUN (no writes — pass --apply to commit)\n");

  let changed = 0;

  for (const rec of records) {
    const tz = rec.checkInTz || "UTC";
    const { isLate, lateMinutes } = computeLate(rec.checkIn, cfg, tz);

    if (isLate !== rec.isLate || lateMinutes !== rec.lateMinutes) {
      changed++;
      const dateStr = rec.date.toISOString().split("T")[0];
      console.log(
        `#${rec.id} (${dateStr}, ${tz}): ` +
        `isLate ${rec.isLate}→${isLate}, lateMinutes ${rec.lateMinutes}→${lateMinutes}`,
      );

      if (apply) {
        await db.attendance.update({
          where: { id: rec.id },
          data: { isLate, lateMinutes },
        });
      }
    }
  }

  console.log(`\n${changed} record(s) ${apply ? "updated" : "would be updated"} out of ${records.length} checked.`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
