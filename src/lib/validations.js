// src/lib/validations.js
// zod v3.25: The ZodError.errors shape is unchanged from v3.23.
// All .errors[0].message patterns in route handlers continue to work correctly.
const { z } = require("zod");

const TimeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm format");

const TimezoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}, "Invalid timezone");

const LoginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password min 6 chars"),
});

const CheckInSchema = z.object({
  timezone: TimezoneSchema.default("UTC"),
  notes: z.string().max(500).optional(),
});

const CheckOutSchema = z.object({
  timezone: TimezoneSchema.default("UTC"),
  notes: z.string().max(500).optional(),
});

const ManualAttendanceSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkInTime: TimeStringSchema,
    checkOutTime: TimeStringSchema.optional().or(z.literal("")),
    timezone: TimezoneSchema.default("UTC"),
    notes: z.string().max(500).optional(),
  })
  .refine(d => !d.checkOutTime || d.checkOutTime > d.checkInTime, {
    message: "Check out must be after check in for the selected date",
    path: ["checkOutTime"],
  });

const AttendanceFilterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.enum(["late", "halfday", "present"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// FIX (ApplyLeaveSchema TZ): The original todayISO() used new Date().toISOString()
// which is always UTC.  The startDate the client sends is a *local* date string
// (YYYY-MM-DD in the user's timezone).  When an employee applies at e.g. 00:30 local
// time (UTC-0:30), todayISO() still returns yesterday's UTC date, so the refine
// rejects their request as "past date" even though it's today locally.
//
// The ApplyLeaveSchema now accepts an optional `timezone` field (the client
// already sends one on every leave apply request via the body, but the schema
// previously discarded it).  We resolve "today" in that timezone so the
// comparison is always apples-to-apples.  If no timezone is provided we fall
// back to UTC, which preserves the old behaviour for callers that don't send one.
//
// todayInZone(tz) re-implements the same Intl-based date-string logic used in
// attendanceService so there is a single canonical way to resolve "today" from
// a timezone string throughout the codebase.
function todayInZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  } catch {
    // Fallback: invalid timezone → use UTC
    return new Date().toISOString().split("T")[0];
  }
}

const ApplyLeaveSchema = z
  .object({
    type: z.enum(["CL", "SL", "PL"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(5, "Reason min 5 chars").max(500),
    // timezone is used only for the "past date" validation; it is not stored.
    timezone: z.string().optional(),
    // department is resolved server-side (see POST /api/leaves) and is used
    // only to scope which holidays offset the chargeable day count; not stored.
    department: z.string().optional(),
  })
  .refine(d => d.endDate >= d.startDate, {
    message: "End date must be >= start date", path: ["endDate"],
  })
  .refine(
    d => d.startDate >= todayInZone(d.timezone || "UTC"),
    { message: "Cannot apply leave for past dates", path: ["startDate"] },
  );

const CreateHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(2, "Name min 2 chars").max(150),
  description: z.string().max(500).optional(),
  department: z.string().max(100).optional(),
});

const RegularizationRequestSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkInTime: TimeStringSchema,
    checkOutTime: TimeStringSchema.optional().or(z.literal("")),
    timezone: TimezoneSchema.default("UTC"),
    reason: z.string().min(5, "Reason min 5 chars").max(500),
  })
  .refine(d => !d.checkOutTime || d.checkOutTime > d.checkInTime, {
    message: "Check out must be after check in",
    path: ["checkOutTime"],
  })
  .refine(d => d.date <= todayInZone(d.timezone || "UTC"), {
    message: "Cannot request regularization for a future date",
    path: ["date"],
  });

const ReviewRegularizationSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().max(500).optional(),
});

const RecordPastLeaveSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
    type: z.enum(["CL", "SL", "PL"]),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1, "Add at least one leave date").max(100),
    reason: z.string().min(5, "Reason min 5 chars").max(500),
  })
  .refine(d => new Set(d.dates).size === d.dates.length, {
    message: "Duplicate leave dates are not allowed", path: ["dates"],
  });

const ReviewLeaveSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().max(500).optional(),
});

const LeaveFilterSchema = z.object({
  status: z.string().default("all"),
  userId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
  department: z.string().min(1),
  designation: z.string().optional(),
  timezone: z.string().default("UTC"),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

module.exports = {
  LoginSchema, CheckInSchema, CheckOutSchema,
  ManualAttendanceSchema, AttendanceFilterSchema, ApplyLeaveSchema, RecordPastLeaveSchema, ReviewLeaveSchema,
  LeaveFilterSchema, CreateUserSchema, RefreshSchema,
  CreateHolidaySchema, RegularizationRequestSchema, ReviewRegularizationSchema,
};
