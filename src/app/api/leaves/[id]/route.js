// src/app/api/leaves/[id]/route.js
import { getCurrentUser, assertDirectReport, handleApiError, ApiError } from "@/lib/auth";
import { db }                                           from "@/lib/db";
import { leaveService }                             from "@/services/leaveService";
import { ReviewLeaveSchema }                        from "@/lib/validations";

// PATCH /api/leaves/:id  — admin: approve or reject
export async function PATCH(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN" && !user.isManager) throw new ApiError("Manager access required", 403);
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid leave ID", 422);
    if (user.role !== "ADMIN") {
      const leave = await db.leaveRequest.findUnique({ where: { id }, select: { userId: true } });
      if (!leave) throw new ApiError("Leave not found", 404);
      await assertDirectReport(user.id, leave.userId);
    }
    const body    = ReviewLeaveSchema.parse(await request.json());
    const updated = await leaveService.review(id, user.id, body);
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
