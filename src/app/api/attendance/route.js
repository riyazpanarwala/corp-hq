// src/app/api/attendance/route.js
import { getCurrentUser, getDirectReportIds, assertDirectReport, handleApiError, ApiError } from "@/lib/auth";
import { attendanceService }                        from "@/services/attendanceService";
import { AttendanceFilterSchema, CheckInSchema, ManualAttendanceSchema } from "@/lib/validations";

// GET /api/attendance
export async function GET(request) {
  try {
    const user   = getCurrentUser(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const filters = AttendanceFilterSchema.parse(params);
    if (user.isManager && params.scope === "team") {
      if (filters.userId) await assertDirectReport(user.id, filters.userId);
      else filters.userIds = await getDirectReportIds(user.id);
    } else if (user.role === "EMPLOYEE") {
      filters.userId = user.id;
    }
    const result = await attendanceService.list(filters);
    return Response.json(result);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

// POST /api/attendance -- employee check-in, or admin manual attendance entry
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    const json = await request.json();
    const isManualEntry = json.userId || json.date || json.checkInTime || json.checkOutTime;
    let record;

    if (isManualEntry) {
      if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);
      const body = ManualAttendanceSchema.parse(json);
      record = await attendanceService.recordManual(body);
    } else {
      const body = CheckInSchema.parse(json);
      record = await attendanceService.checkIn(user.id, body);
    }

    return Response.json(record, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
