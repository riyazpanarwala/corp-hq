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

// POST /api/leaves — apply for leave
//
// FIX (timezone bypass): The previous code injected the DB timezone only when
// the client didn't send one (if (!body.timezone)).  A malicious client could
// supply their own timezone to shift the "past date" boundary and apply leave
// for what is actually yesterday in the server's timezone.
//
// We now ALWAYS fetch the authenticated user's stored timezone from the DB and
// overwrite whatever the client sent.  The client-supplied value is discarded
// entirely.  "UTC" is used only as a last resort if the stored timezone is
// missing (new user, bad data).
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    const body = await request.json();

    // Always resolve timezone server-side — never trust client input
    const stored = await db.user.findUnique({
      where:  { id: user.id },
      select: { timezone: true },
    });
    body.timezone = stored?.timezone || "UTC";

    const parsed = ApplyLeaveSchema.parse(body);
    const leave  = await leaveService.apply(user.id, parsed);
    return Response.json(leave, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
