// src/app/api/auth/login/route.js
import { db } from "@/lib/db";
import { signAccessToken, signRefreshToken, refreshTokenExpiry, handleApiError } from "@/lib/auth";
import { LoginSchema } from "@/lib/validations";
import bcrypt      from "bcryptjs";
import { cookies } from "next/headers";

const DUMMY_HASH = "$2b$12$invalidsaltXXXXXXXXXXXXXXinvalidhashXXXXXXXXXXXXXXX";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    const user = await db.user.findUnique({
      where:  { email: email.toLowerCase().trim(), isActive: true },
      select: { id: true, email: true, name: true, role: true, department: true, designation: true, timezone: true, avatarUrl: true, passwordHash: true },
    });

    const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatch) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const { passwordHash, ...safeUser } = user;

    const accessToken  = await signAccessToken({ sub: String(user.id), email: user.email, role: user.role, name: user.name });
    const refreshToken = await signRefreshToken(user.id);

    await db.session.create({
      data: {
        userId:       user.id,
        refreshToken,
        expiresAt:    refreshTokenExpiry(),
        ipAddress:    request.headers.get("x-forwarded-for") ?? undefined,
        userAgent:    request.headers.get("user-agent")      ?? undefined,
      },
    });

    const cookieStore = await cookies();

    cookieStore.set("access_token", accessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      path: "/", sameSite: "strict", maxAge: 15 * 60,
    });

    cookieStore.set("refresh_token", refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      path: "/api/auth", sameSite: "strict", maxAge: 7 * 24 * 60 * 60,
    });

    return Response.json({ accessToken, user: safeUser });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
