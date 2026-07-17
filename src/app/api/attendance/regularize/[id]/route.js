import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { regularizationService } from "@/services/regularizationService";
import { ReviewRegularizationSchema } from "@/lib/validations";

// PATCH — admin: approve or reject
export async function PATCH(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid request ID", 422);
    const body = ReviewRegularizationSchema.parse(await request.json());
    const updated = await regularizationService.review(id, user.id, body);
    return Response.json(updated);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

// DELETE — employee: cancel own pending request
export async function DELETE(request, { params }) {
  try {
    const user = getCurrentUser(request);
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid request ID", 422);
    await regularizationService.cancel(id, user.id);
    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}