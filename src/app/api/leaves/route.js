// src/app/api/leaves/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { leaveService }                   from "@/services/leaveService";
import { ApplyLeaveSchema, LeaveFilterSchema } from "@/lib/validations";

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
export async function POST(request) {
  try {
    const user  = getCurrentUser(request);
    const body  = ApplyLeaveSchema.parse(await request.json());
    const leave = await leaveService.apply(user.id, body);
    return Response.json(leave, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
