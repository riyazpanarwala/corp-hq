// src/app/api/users/route.js
import { db }                                          from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError }   from "@/lib/auth";
import { CreateUserSchema }                            from "@/lib/validations";
import bcrypt from "bcryptjs";

export async function GET(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN" && !user.isManager) throw new ApiError("Forbidden", 403);
    const users = await db.user.findMany({
      where: user.role === "ADMIN"
        ? { isActive: true }
        : { isActive: true, managerId: user.id },
      select:  {
        id: true, email: true, name: true, role: true, department: true,
        designation: true, timezone: true, managerId: true, biometricId: true, createdAt: true,
        manager: { select: { id: true, name: true } },
        _count: { select: { directReports: { where: { isActive: true } } } },
      },
      orderBy: { name: "asc" },
    });
    return Response.json({ users });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Forbidden", 403);
    const body         = CreateUserSchema.parse(await request.json());
    if (body.managerId) {
      const manager = await db.user.findFirst({
        where: { id: body.managerId, isActive: true },
        select: { id: true },
      });
      if (!manager) throw new ApiError("Manager not found", 422);
    }
    if (body.biometricId) {
      const existingBio = await db.user.findUnique({
        where: { biometricId: body.biometricId },
        select: { id: true, name: true },
      });
      if (existingBio) throw new ApiError(`Biometric ID already assigned to ${existingBio.name}`, 422);
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { password, ...rest } = body;
    const newUser = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { ...rest, passwordHash },
        select: { id: true, email: true, name: true, role: true, department: true, managerId: true, biometricId: true },
      });
      await tx.leaveBalance.create({ data: { userId: u.id, year: new Date().getFullYear() } });
      return u;
    });
    return Response.json(newUser, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
