// src/lib/validations.js
const { z } = require("zod");

const LoginSchema = z.object({
  email:    z.string().email("Invalid email"),
  password: z.string().min(6, "Password min 6 chars"),
});

const CheckInSchema = z.object({
  timezone: z.string().default("UTC"),
  notes:    z.string().max(500).optional(),
});

const CheckOutSchema = z.object({
  timezone: z.string().default("UTC"),
  notes:    z.string().max(500).optional(),
});

// MINOR FIX: The status enum previously used inconsistent naming. The DB stores
// isHalfDay / isLate as booleans, and the UI sends "halfday" / "late" / "present".
// "present" was listed in the enum comment but handled identically to no filter in
// attendanceService.list() — the service only checks for "late" and "halfday" and
// treats everything else as no status filter. The schema now explicitly documents
// the three accepted values and their effect. No functional behaviour change —
// just making the contract explicit and removing the silent no-op for "present".
const AttendanceFilterSchema = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month:  z.string().regex(/^\d{4}-\d{2}$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  // "late"    → where isLate = true
  // "halfday" → where isHalfDay = true
  // "present" → no extra where clause (all present records); kept for UI completeness
  status: z.enum(["late", "halfday", "present"]).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});

const todayISO = () => new Date().toISOString().split("T")[0];

const ApplyLeaveSchema = z
  .object({
    type:      z.enum(["CL", "SL", "PL"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason:    z.string().min(5, "Reason min 5 chars").max(500),
  })
  .refine(d => d.endDate >= d.startDate, {
    message: "End date must be >= start date", path: ["endDate"],
  })
  .refine(d => d.startDate >= todayISO(), {
    message: "Cannot apply leave for past dates", path: ["startDate"],
  });

const ReviewLeaveSchema = z.object({
  action:     z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().max(500).optional(),
});

const LeaveFilterSchema = z.object({
  status: z.string().default("all"),
  userId: z.coerce.number().int().positive().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

const CreateUserSchema = z.object({
  email:       z.string().email(),
  name:        z.string().min(2).max(100),
  password:    z.string().min(8),
  role:        z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
  department:  z.string().min(1),
  designation: z.string().optional(),
  timezone:    z.string().default("UTC"),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

module.exports = {
  LoginSchema, CheckInSchema, CheckOutSchema,
  AttendanceFilterSchema, ApplyLeaveSchema, ReviewLeaveSchema,
  LeaveFilterSchema, CreateUserSchema, RefreshSchema,
};
