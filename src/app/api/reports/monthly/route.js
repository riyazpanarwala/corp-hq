// src/app/api/reports/monthly/route.js
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { attendanceService }                         from "@/services/attendanceService";

export async function GET(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const sp    = new URL(request.url).searchParams;
    const year  = parseInt(sp.get("year")  || String(new Date().getFullYear()));
    const month = parseInt(sp.get("month") || String(new Date().getMonth() + 1));

    const summary = await attendanceService.monthlySummary(year, month);
    return Response.json({ summary, year, month });
  } catch (err) {
    return handleApiError(err);
  }
}
