// src/app/api/auth/login/route.js
import { db } from "@/lib/db";
import { signAccessToken, signRefreshToken, refreshTokenExpiry, handleApiError } from "@/lib/auth";
import { LoginSchema } from "@/lib/validations";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import bcrypt      from "bcryptjs";
import { cookies } from "next/headers";

const DUMMY_HASH = "$2b$12$invalidsaltXXXXXXXXXXXXXXinvalidhashXXXXXXXXXXXXXXX";

export async function POST(request) {
  // ── Rate limit check ────────────────────────────────────────────────────────
  // Key on IP so each client has its own attempt bucket.
  // We check BEFORE parsing the body — no point doing any work if blocked.
  const ip  = getClientIp(request);
  const key = `login:${ip}`;

  // Initial check (success=false, we haven't verified credentials yet)
  const limitCheck = rateLimit(key);
  if (!limitCheck.allowed) {
    return Response.json(
      {
        error: `Too many failed login attempts. Please try again in ${Math.ceil(limitCheck.retryAfter / 60)} minute(s).`,
        retryAfter: limitCheck.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After":       String(limitCheck.retryAfter),
          "X-RateLimit-Limit": String(10),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }
  // ────────────────────────────────────────────────────────────────────────────

  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    const user = await db.user.findUnique({
      where:  { email: email.toLowerCase().trim(), isActive: true },
      select: { id: true, email: true, name: true, role: true, department: true, designation: true, timezone: true, avatarUrl: true, passwordHash: true },
    });

    const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatch) {
      // Failed attempt — rateLimit already incremented above on the initial
      // check (attempts: 1). For clarity we don't double-count; the initial
      // call above already recorded this attempt in the bucket.
      return Response.json(
        {
          error: "Invalid email or password",
          // Inform the client how many attempts remain so the UI can warn them
          attemptsRemaining: limitCheck.remaining,
        },
        {
          status: 401,
          headers: {
            "X-RateLimit-Remaining": String(limitCheck.remaining),
          },
        },
      );
    }

    // ── Successful login → reset the rate-limit bucket for this IP ────────────
    rateLimit(key, true /* success */);

    const { passwordHash, ...safeUser } = user;

    const accessToken  = await signAccessToken({ sub: String(user.id), email: user.email, role: user.role, name: user.name });
    const refreshToken = await signRefreshToken(user.id);

    await db.session.create({
      data: {
        userId:       user.id,
        refreshToken,
        expiresAt:    refreshTokenExpiry(),
        ipAddress:    ip,
        userAgent:    request.headers.get("user-agent") ?? undefined,
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
