// src/app/api/attendance/config/route.js
import { db } from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { UpdateAttendanceConfigSchema } from "@/lib/validations";

// GET /api/attendance/config
export async function GET(request) {
  try {
    getCurrentUser(request);
    const config = await db.attendanceConfig.findFirst();
    return Response.json({ config });
  } catch (err) {
    return handleApiError(err);
  }
}

// PATCH /api/attendance/config -- admin toggles geofence/IP policy
export async function PATCH(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);

    const body = UpdateAttendanceConfigSchema.parse(await request.json());
    const existing = await db.attendanceConfig.findFirst();

    const updated = await db.attendanceConfig.update({
      where: { id: existing?.id || 1 },
      data: {
        ...(body.enforceGeofence !== undefined && { enforceGeofence: body.enforceGeofence }),
        ...(body.enforceIp !== undefined && { enforceIp: body.enforceIp }),
      },
    });

    return Response.json({ config: updated });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
