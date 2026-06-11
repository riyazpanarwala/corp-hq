import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { RecordPastLeaveSchema } from "@/lib/validations";
import { leaveService } from "@/services/leaveService";

export async function POST(request) {
  try {
    const admin = getCurrentUser(request);
    if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const body = RecordPastLeaveSchema.parse(await request.json());
    const leaves = await leaveService.recordPast(admin.id, body);
    return Response.json({ leaves, count: leaves.length }, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
