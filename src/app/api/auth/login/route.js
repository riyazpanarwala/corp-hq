// src/app/api/auth/login/route.js
import { db } from "@/lib/db";
import {
  signAccessToken,
  signRefreshToken,
  refreshTokenExpiry,
  handleApiError,
} from "@/lib/auth";
import { LoginSchema } from "@/lib/validations";
import bcrypt          from "bcryptjs";
import { cookies }     from "next/headers";

// A real bcrypt hash of "invalid-user-dummy-password".
// Used so the bcrypt.compare call always runs regardless of whether the
// user exists, preventing a timing oracle that would let an attacker
// enumerate valid email addresses by measuring response latency.
const DUMMY_HASH =
  "$2b$12$invalidsaltXXXXXXXXXXXXXXinvalidhashXXXXXXXXXXXXXXX";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    const user = await db.user.findUnique({
      where:  { email: email.toLowerCase().trim(), isActive: true },
      select: {
        id: true, email: true, name: true, role: true,
        department: true, designation: true, timezone: true,
        avatarUrl: true, passwordHash: true,
      },
    });

    // Always run bcrypt — even when the user doesn't exist — so that the
    // response time is identical for unknown-email vs wrong-password cases.
    const passwordMatch = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !passwordMatch) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const { passwordHash, ...safeUser } = user;

    const accessToken  = await signAccessToken({
      sub: String(user.id), email: user.email, role: user.role, name: user.name,
    });
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

    // Access token cookie — short-lived, used for SSR page authentication
    cookieStore.set("access_token", accessToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",
      sameSite: "strict",   // upgraded from "lax" — prevents CSRF on all cross-site requests
      maxAge:   15 * 60,    // 15 minutes, mirrors JWT expiry
    });

    // Refresh token cookie — long-lived, httpOnly, scoped to the refresh
    // endpoint only. It is never readable by JavaScript on the page.
    // Not returned in the response body for the same reason.
    cookieStore.set("refresh_token", refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/api/auth",   // only sent to /api/auth/* — not every request
      sameSite: "strict",
      maxAge:   7 * 24 * 60 * 60,  // 7 days, mirrors session expiry
    });

    // Return the access token in the body so the client can store it
    // in memory (via useAuth) for Authorization header use. The refresh
    // token is intentionally omitted — it lives in the cookie only.
    return Response.json({ accessToken, user: safeUser });
  } catch (err) {
    if (err?.errors)
      return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
