// src/app/api/offices/route.js
import { db } from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { OfficeLocationSchema } from "@/lib/validations";

// GET /api/offices -- list offices (admins see all with allowedIps; non-admins see only active without allowedIps)
export async function GET(request) {
  try {
    const user = getCurrentUser(request);
    const isAdmin = user.role === "ADMIN";

    const offices = await db.officeLocation.findMany({
      where: isAdmin ? undefined : { isActive: true },
      orderBy: { name: "asc" },
      select: isAdmin
        ? undefined
        : {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            radiusMeters: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
    });
    return Response.json({ offices });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/offices -- admin creates office location
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);

    const body = OfficeLocationSchema.parse(await request.json());
    const office = await db.officeLocation.create({
      data: {
        name: body.name.trim(),
        latitude: body.latitude,
        longitude: body.longitude,
        radiusMeters: body.radiusMeters,
        allowedIps: body.allowedIps || [],
        isActive: body.isActive ?? true,
      },
    });

    return Response.json(office, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
