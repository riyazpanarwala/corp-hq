// src/app/api/attendance/today/route.js
//
// FIX (getTodayRecord TZ): The old service signature was getTodayRecord(userId, timezone)
// but this route never passed a timezone, so the service always fell back to the
// user's *stored* timezone — which may differ from the one used at check-in if
// the employee travels or changes devices.
//
// getTodayRecord() now derives the correct timezone internally by looking at the
// checkInTz on the most-recent open record (the timezone that was actually used
// when the row was written).  The route just passes the userId.
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
