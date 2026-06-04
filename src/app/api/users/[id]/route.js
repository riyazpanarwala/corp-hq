// src/app/api/users/[id]/route.js
import { db }                                        from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";

export async function DELETE(request, { params }) {
  try {
    const admin = getCurrentUser(request);
    if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid user ID", 422);
    if (id === admin.id) throw new ApiError("You cannot remove your own account", 400);

    const target = await db.user.findUnique({
      where:  { id },
      select: { id: true, role: true, isActive: true },
    });

    if (!target || !target.isActive || target.role !== "EMPLOYEE") {
      throw new ApiError("Employee not found", 404);
    }

    await db.$transaction([
      db.user.update({ where: { id }, data: { isActive: false } }),
      db.session.deleteMany({ where: { userId: id } }),
    ]);

    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
