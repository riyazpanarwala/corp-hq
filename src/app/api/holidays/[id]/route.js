import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { holidayService } from "@/services/holidayService";

export async function DELETE(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid holiday ID", 422);
    await holidayService.remove(id);
    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}