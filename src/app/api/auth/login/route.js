// src/app/api/auth/login/route.js
import { db } from "@/lib/db";
import { signAccessToken, signRefreshToken, refreshTokenExpiry, handleApiError } from "@/lib/auth";
import { LoginSchema } from "@/lib/validations";
import { peek, consume, reset, getClientIp, MAX_ATTEMPTS } from "@/lib/rateLimit";
import bcrypt      from "bcryptjs";
import { cookies } from "next/headers";

const DUMMY_HASH = "$2b$12$invalidsaltXXXXXXXXXXXXXXinvalidhashXXXXXXXXXXXXXXX";

export async function POST(request) {
  const ip  = getClientIp(request);
  const key = `login:${ip}`;

  // ── 1. Peek — reject already-blocked IPs before doing ANY work ────────────
  // peek() is read-only: it never increments the attempt counter.
  // This means a DB outage or JSON parse error below will NOT burn an attempt.
  const gate = peek(key);
  if (!gate.allowed) {
    return Response.json(
      {
        error:      `Too many failed login attempts. Please try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`,
        retryAfter: gate.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After":           String(gate.retryAfter),
          "X-RateLimit-Limit":     String(MAX_ATTEMPTS),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

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

    const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatch) {
      // ── 2. consume() — only called on a confirmed wrong-password failure ──
      // Server errors (parse, DB) above would have thrown and been caught
      // below, so this line is only reached on genuine bad credentials.
      const result = consume(key);
      return Response.json(
        {
          error:             "Invalid email or password",
          attemptsRemaining: result.remaining,
          // Surface a block warning when they're about to hit the limit
          ...(result.remaining <= 3 && result.remaining > 0 && {
            warning: `${result.remaining} attempt${result.remaining !== 1 ? "s" : ""} remaining before your IP is temporarily blocked.`,
          }),
          ...(!result.allowed && {
            warning: `Too many failed attempts. Your IP is now blocked for ${Math.ceil(result.retryAfter / 60)} minute(s).`,
          }),
        },
        {
          status: 401,
          headers: {
            "X-RateLimit-Limit":     String(MAX_ATTEMPTS),
            "X-RateLimit-Remaining": String(result.remaining),
          },
        },
      );
    }

    // ── 3. reset() — clear the bucket on successful login ─────────────────
    reset(key);

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
    // Parsing / validation / server errors — do NOT consume a rate-limit attempt
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
