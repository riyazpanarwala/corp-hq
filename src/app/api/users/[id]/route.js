// src/app/api/users/[id]/route.js
import { db }                                        from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { UpdateUserSchema }                          from "@/lib/validations";
import bcrypt                                        from "bcryptjs";

export async function PATCH(request, { params }) {
  try {
    const admin = getCurrentUser(request);
    if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid user ID", 422);

    const body = UpdateUserSchema.parse(await request.json());

    const target = await db.user.findFirst({
      where: { id, isActive: true },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) throw new ApiError("Employee not found", 404);

    let passwordHash = null;
    if (body.password !== undefined) {
      passwordHash = await bcrypt.hash(body.password, 12);
    }

    if (body.managerId !== undefined) {
      const managerId = body.managerId;
      if (managerId === id) throw new ApiError("An employee cannot manage themselves", 422);

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
    }

    const dataToUpdate = {};
    if (body.managerId !== undefined) {
      dataToUpdate.managerId = body.managerId;
    }
    if (passwordHash !== null) {
      dataToUpdate.passwordHash = passwordHash;
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: dataToUpdate,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          department: true,
          managerId: true,
          manager: { select: { id: true, name: true } },
        },
      });

      if (passwordHash !== null) {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.passwordResetToken.updateMany({
          where: { userId: id, usedAt: null },
          data: { usedAt: new Date() },
        });
      }

      return u;
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
