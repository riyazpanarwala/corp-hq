// src/app/api/users/[id]/route.js
import { db }                                        from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { UpdateUserHierarchySchema }                from "@/lib/validations";

export async function PATCH(request, { params }) {
  try {
    const admin = getCurrentUser(request);
    if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid user ID", 422);

    const { managerId } = UpdateUserHierarchySchema.parse(await request.json());
    if (managerId === id) throw new ApiError("An employee cannot manage themselves", 422);

    const target = await db.user.findFirst({ where: { id, isActive: true }, select: { id: true } });
    if (!target) throw new ApiError("Employee not found", 404);

    if (managerId !== null) {
      let currentId = managerId;
      const visited = new Set();
      while (currentId !== null) {
        if (currentId === id) throw new ApiError("This assignment would create a management cycle", 422);
        if (visited.has(currentId)) throw new ApiError("Existing management cycle detected", 422);
        visited.add(currentId);
        const current = await db.user.findFirst({
          where: { id: currentId, isActive: true },
          select: { managerId: true },
        });
        if (!current) throw new ApiError("Manager not found", 422);
        currentId = current.managerId;
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: { managerId },
      select: { id: true, managerId: true, manager: { select: { id: true, name: true } } },
    });
    return Response.json(updated);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const admin = getCurrentUser(request);
    if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const { id: rawId } = await params;
    const id = Number(rawId);
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
      db.user.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      db.session.deleteMany({ where: { userId: id } }),
    ]);

    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
