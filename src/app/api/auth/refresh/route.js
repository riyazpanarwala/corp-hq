// src/app/api/auth/refresh/route.js
import { db }      from "@/lib/db";
import { cookies } from "next/headers";
import { verifyRefreshToken, signAccessToken, signRefreshToken, refreshTokenExpiry } from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore  = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;

    if (!refreshToken) {
      return Response.json({ error: "No active session" }, { status: 401 });
    }

    await verifyRefreshToken(refreshToken);

    const session = await db.session.findUnique({
      where:   { refreshToken },
      include: { user: { select: { id: true, email: true, role: true, name: true, isActive: true } } },
    });

    if (!session || !session.user.isActive || session.expiresAt < new Date()) {
      cookieStore.set("refresh_token", "", {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        path:     "/api/auth",
        sameSite: "strict",
        maxAge:   0,
      });
      return Response.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const newAccessToken  = await signAccessToken({
      sub:   String(session.user.id),
      email: session.user.email,
      role:  session.user.role,
      name:  session.user.name,
    });
    const newRefreshToken = await signRefreshToken(session.user.id);

    await db.session.update({
      where: { id: session.id },
      data:  { refreshToken: newRefreshToken, expiresAt: refreshTokenExpiry() },
    });

    // FIX: Also update the access_token cookie so the proxy (src/proxy.js)
    // sees the fresh token on subsequent page navigations.  Previously only
    // the refresh_token cookie was rotated here, leaving the access_token
    // cookie stale after the first 15-minute expiry.  The proxy reads the
    // cookie for every SSR page request — if it's expired the user gets
    // redirected to /login even though localStorage has a valid token,
    // producing a blank screen on corp-hq.panarwala.in.
    cookieStore.set("access_token", newAccessToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",
      sameSite: "strict",
      maxAge:   15 * 60,
    });

    cookieStore.set("refresh_token", newRefreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/api/auth",
      sameSite: "strict",
      maxAge:   7 * 24 * 60 * 60,
    });

    return Response.json({ accessToken: newAccessToken });
  } catch {
    return Response.json({ error: "Invalid refresh token" }, { status: 401 });
  }
}
