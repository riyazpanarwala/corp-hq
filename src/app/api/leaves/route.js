// src/app/api/leaves/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { leaveService }                   from "@/services/leaveService";
import { ApplyLeaveSchema, LeaveFilterSchema } from "@/lib/validations";
import { db } from "@/lib/db";

// GET /api/leaves
export async function GET(request) {
  try {
    const user    = getCurrentUser(request);
    const params  = Object.fromEntries(new URL(request.url).searchParams);
    const filters = LeaveFilterSchema.parse(params);
    if (user.role === "EMPLOYEE") filters.userId = user.id;
    const result  = await leaveService.list(filters);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/leaves  — apply for leave
//
// FIX (ApplyLeaveSchema TZ): The "past date" refine in ApplyLeaveSchema now
// needs a timezone so it can resolve "today" in the employee's local zone rather
// than UTC.  The client's leave form doesn't send a timezone field, so we inject
// the user's stored timezone here on the server side before validation.  This
// means no client changes are required.
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    const body = await request.json();

    // Resolve the employee's timezone for the "past date" validation.
    // We prefer the timezone the client explicitly sends (future-proofing),
    // then fall back to the stored user timezone, then UTC.
    if (!body.timezone) {
      const stored = await db.user.findUnique({
        where:  { id: user.id },
        select: { timezone: true },
      });
      body.timezone = stored?.timezone || "UTC";
    }

    const parsed = ApplyLeaveSchema.parse(body);
    const leave  = await leaveService.apply(user.id, parsed);
    return Response.json(leave, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
