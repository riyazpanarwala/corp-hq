// src/app/api/leaves/[id]/route.js
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { leaveService }                             from "@/services/leaveService";
import { ReviewLeaveSchema }                        from "@/lib/validations";

// PATCH /api/leaves/:id  — admin: approve or reject
export async function PATCH(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);
    const body    = ReviewLeaveSchema.parse(await request.json());
    const updated = await leaveService.review(parseInt(params.id), user.id, body);
    return Response.json(updated);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

// DELETE /api/leaves/:id  — employee: cancel
export async function DELETE(request, { params }) {
  try {
    const user = getCurrentUser(request);
    await leaveService.cancel(parseInt(params.id), user.id);
    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
