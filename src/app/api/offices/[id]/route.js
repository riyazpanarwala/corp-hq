// src/app/api/offices/[id]/route.js
import { db } from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { OfficeLocationSchema } from "@/lib/validations";

export async function PATCH(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid office ID", 422);

    const body = OfficeLocationSchema.partial().parse(await request.json());

    const updated = await db.officeLocation.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name.trim() }),
        ...(body.latitude !== undefined && { latitude: body.latitude }),
        ...(body.longitude !== undefined && { longitude: body.longitude }),
        ...(body.radiusMeters !== undefined && { radiusMeters: body.radiusMeters }),
        ...(body.allowedIps !== undefined && { allowedIps: body.allowedIps }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    return Response.json(updated);
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError("Invalid office ID", 422);

    await db.officeLocation.delete({
      where: { id },
    });

    return Response.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
