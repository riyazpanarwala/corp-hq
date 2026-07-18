// src/app/api/leaves/route.js
import { getCurrentUser, getDirectReportIds, assertDirectReport, handleApiError } from "@/lib/auth";
import { leaveService } from "@/services/leaveService";
import { ApplyLeaveSchema, LeaveFilterSchema } from "@/lib/validations";
import { db } from "@/lib/db";

// GET /api/leaves
export async function GET(request) {
  try {
    const user = getCurrentUser(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const filters = LeaveFilterSchema.parse(params);
    if (user.isManager && params.scope === "team") {
      if (filters.userId) await assertDirectReport(user.id, filters.userId);
      else filters.userIds = await getDirectReportIds(user.id);
    } else if (user.role === "EMPLOYEE") {
      filters.userId = user.id;
    }
    const result = await leaveService.list(filters);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/leaves — apply for leave
//
// FIX (timezone bypass): as before, the client-supplied timezone is always
// discarded and replaced with the DB value.
//
// FIX (department for holiday scoping): department is now also resolved
// server-side in the same query, and passed through to leaveService.apply()
// so it can exclude department-scoped holidays from the chargeable day count.
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 422 });
    }

    const stored = await db.user.findUnique({
      where: { id: user.id },
      select: { timezone: true, department: true },
    });
    body.timezone = stored?.timezone || "UTC";
    body.department = stored?.department;

    const parsed = ApplyLeaveSchema.parse(body);
    const leave = await leaveService.apply(user.id, parsed);
    return Response.json(leave, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
