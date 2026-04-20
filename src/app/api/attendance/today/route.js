// src/app/api/attendance/today/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { attendanceService }              from "@/services/attendanceService";

export async function GET(request) {
  try {
    const user   = getCurrentUser(request);
    const record = await attendanceService.getTodayRecord(user.id);
    return Response.json({ record });
  } catch (err) {
    return handleApiError(err);
  }
}
