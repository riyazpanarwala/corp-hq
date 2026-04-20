// src/app/api/auth/login/route.js
import { db } from "@/lib/db";
import {
  signAccessToken,
  signRefreshToken,
  refreshTokenExpiry,
  handleApiError,
} from "@/lib/auth";
import { LoginSchema } from "@/lib/validations";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers"; // 👈 ADD THIS

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        designation: true,
        timezone: true,
        avatarUrl: true,
        passwordHash: true,
      },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const { passwordHash, ...safeUser } = user;

    const accessToken = await signAccessToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
      name: user.name,
    });
    const refreshToken = await signRefreshToken(user.id);

    await db.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: refreshTokenExpiry(),
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });

    const response = Response.json({
      accessToken,
      refreshToken,
      user: safeUser,
    });

    // 👇 SET COOKIE HERE
    cookies().set("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    return response;
  } catch (err) {
    if (err?.errors)
      return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
