// src/app/api/attendance/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { attendanceService }              from "@/services/attendanceService";
import { AttendanceFilterSchema, CheckInSchema } from "@/lib/validations";

// GET /api/attendance
export async function GET(request) {
  try {
    const user   = getCurrentUser(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const filters = AttendanceFilterSchema.parse(params);
    if (user.role === "EMPLOYEE") filters.userId = user.id;
    const result = await attendanceService.list(filters);
    return Response.json(result);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

// POST /api/attendance  — check in
export async function POST(request) {
  try {
    const user   = getCurrentUser(request);
    const body   = CheckInSchema.parse(await request.json());
    const record = await attendanceService.checkIn(user.id, body);
    return Response.json(record, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
