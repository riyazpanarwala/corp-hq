// src/app/api/users/route.js
import { db }                                 from "@/lib/db";
import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { CreateUserSchema }                   from "@/lib/validations";
import bcrypt from "bcryptjs";

// GET /api/users — admin only
export async function GET(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const users = await db.user.findMany({
      where:   { isActive: true },
      select:  { id: true, email: true, name: true, role: true, department: true, designation: true, timezone: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    return Response.json({ users });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/users — admin only
export async function POST(request) {
  try {
    const user = getCurrentUser(request);
    if (user.role !== "ADMIN") throw new ApiError("Forbidden", 403);

    const body         = CreateUserSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { password, ...rest } = body;

    const newUser = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data:   { ...rest, passwordHash },
        select: { id: true, email: true, name: true, role: true, department: true },
      });
      await tx.leaveBalance.create({
        data: { userId: u.id, year: new Date().getFullYear() },
      });
      return u;
    });

    return Response.json(newUser, { status: 201 });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
