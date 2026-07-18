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

// FIX (CodeRabbit #9 — impossible calendar dates): the old inline regex
// /^\d{4}-\d{2}-\d{2}$/ accepts "2026-02-31", which then silently rolls over
// when passed to `new Date(...)` (e.g. becomes March 3). Holidays and
// regularizations were storing the wrong date with no error. This shared
// schema validates the format AND reconstructs the date via Date.UTC(),
// confirming the year/month/day didn't roll over.
const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "Invalid calendar date");

const LoginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password min 6 chars"),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

const ResetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, "Invalid reset link"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
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
    return new Date().toISOString().split("T")[0];
  }
}

const ApplyLeaveSchema = z
  .object({
    type: z.enum(["CL", "SL", "PL"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(5, "Reason min 5 chars").max(500),
    timezone: z.string().optional(),
    department: z.string().optional(),
  })
  .refine(d => d.endDate >= d.startDate, {
    message: "End date must be >= start date", path: ["endDate"],
  })
  .refine(
    d => d.startDate >= todayInZone(d.timezone || "UTC"),
    { message: "Cannot apply leave for past dates", path: ["startDate"] },
  );

// FIX (CodeRabbit #9): date now uses the shared calendar-valid DateStringSchema
// instead of the raw regex, so "2026-02-31" is rejected instead of silently
// rolling over when stored.
const CreateHolidaySchema = z.object({
  date: DateStringSchema,
  name: z.string().min(2, "Name min 2 chars").max(150),
  description: z.string().max(500).optional(),
  department: z.string().max(100).optional(),
});

// FIX (CodeRabbit #9): date now uses DateStringSchema (see CreateHolidaySchema
// above) for the same reason — reject impossible calendar dates instead of
// silently normalizing them.
const RegularizationRequestSchema = z
  .object({
    date: DateStringSchema,
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

// FIX (CodeRabbit #9): backs the /api/attendance/regularize GET route —
// previously page/limit/userId were parsed with bare parseInt() and never
// validated, so garbage query params (or an out-of-range limit) reached
// Prisma directly.
const RegularizationFilterSchema = z.object({
  status: z.enum(["all", "PENDING", "APPROVED", "REJECTED"]).default("all"),
  userId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  LoginSchema, ForgotPasswordSchema, ResetPasswordSchema, CheckInSchema, CheckOutSchema,
  ManualAttendanceSchema, AttendanceFilterSchema, ApplyLeaveSchema, RecordPastLeaveSchema, ReviewLeaveSchema,
  LeaveFilterSchema, CreateUserSchema, RefreshSchema,
  CreateHolidaySchema, RegularizationRequestSchema, RegularizationFilterSchema, ReviewRegularizationSchema,
};
