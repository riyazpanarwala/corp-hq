// src/app/api/departments/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { holidayService } from "@/services/holidayService";

// Any authenticated user can read the department list (used to populate
// the holiday form's department selector).
export async function GET(request) {
    try {
        getCurrentUser(request);
        const departments = await holidayService.listDepartments();
        return Response.json({ departments });
    } catch (err) {
        return handleApiError(err);
    }
}