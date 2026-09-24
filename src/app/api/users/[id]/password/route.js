// src/app/api/users/[id]/password/route.js
import { db }                                        from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { UpdateUserPasswordSchema }                  from "@/lib/validations";
import bcrypt                                        from "bcryptjs";

async function handlePasswordUpdate(request, params) {
  const admin = getCurrentUser(request);
  if (admin.role !== "ADMIN") throw new ApiError("Forbidden", 403);

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid user ID", 422);

  const { password } = UpdateUserPasswordSchema.parse(await request.json());

  const target = await db.user.findFirst({
    where: { id, isActive: true },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new ApiError("Employee not found", 404);

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash },
    });

    await tx.session.deleteMany({ where: { userId: id } });
    await tx.passwordResetToken.updateMany({
      where: { userId: id, usedAt: null },
      data: { usedAt: now },
    });
  });

  return Response.json({
    success: true,
    message: `Password updated successfully for ${target.name}`,
  });
}

export async function POST(request, { params }) {
  try {
    return await handlePasswordUpdate(request, params);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

export async function PATCH(request, { params }) {
  try {
    return await handlePasswordUpdate(request, params);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
