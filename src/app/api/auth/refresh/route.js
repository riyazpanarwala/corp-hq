// src/app/api/auth/refresh/route.js
import { db }                from "@/lib/db";
import { cookies }           from "next/headers";
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  refreshTokenExpiry,
} from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();

    // Read the refresh token from the httpOnly cookie — it was never sent
    // to the client as JS-readable data, so we don't accept it from the
    // request body either. If the cookie is absent the session has ended.
    const refreshToken = cookieStore.get("refresh_token")?.value;

    if (!refreshToken) {
      return Response.json({ error: "No active session" }, { status: 401 });
    }

    // Verify the JWT signature and expiry before touching the DB.
    await verifyRefreshToken(refreshToken); // throws if invalid

    const session = await db.session.findUnique({
      where:   { refreshToken },
      include: {
        user: {
          select: {
            id: true, email: true, role: true, name: true, isActive: true,
          },
        },
      },
    });

    if (!session || !session.user.isActive || session.expiresAt < new Date()) {
      // Clear the stale cookie so the browser doesn't keep retrying
      cookieStore.set("refresh_token", "", {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        path:     "/api/auth",
        sameSite: "strict",
        maxAge:   0,
      });
      return Response.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    // Rotate both tokens on every refresh (refresh token rotation)
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

    // Rotate the refresh token cookie
    cookieStore.set("refresh_token", newRefreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/api/auth",
      sameSite: "strict",
      maxAge:   7 * 24 * 60 * 60,
    });

    // Return only the new access token — the client stores it in memory
    return Response.json({ accessToken: newAccessToken });
  } catch {
    return Response.json({ error: "Invalid refresh token" }, { status: 401 });
  }
}
