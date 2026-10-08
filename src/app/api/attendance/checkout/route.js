// src/app/api/attendance/checkout/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { attendanceService }              from "@/services/attendanceService";
import { CheckOutSchema }                 from "@/lib/validations";
import { extractClientIp }                 from "@/lib/geoUtils";

export async function PATCH(request) {
  try {
    const user     = getCurrentUser(request);
    const body     = CheckOutSchema.parse(await request.json());
    const clientIp = extractClientIp(request);
    const record   = await attendanceService.checkOut(user.id, { ...body, clientIp });
    return Response.json(record);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
