// src/app/api/offices/route.js
import { db } from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { OfficeLocationSchema } from "@/lib/validations";

// GET /api/offices -- list active offices (accessible to all authenticated users)
export async function GET(request) {
  try {
    getCurrentUser(request); // Requires authenticated user
    const offices = await db.officeLocation.findMany({
      orderBy: { name: "asc" },
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
