// src/app/api/auth/refresh/route.js
import { db } from "@/lib/db";
import { verifyRefreshToken, signAccessToken, signRefreshToken, refreshTokenExpiry } from "@/lib/auth";

export async function POST(request) {
  try {
    const { refreshToken } = await request.json();
    if (!refreshToken) return Response.json({ error: "Refresh token required" }, { status: 400 });

    await verifyRefreshToken(refreshToken); // throws if expired / invalid

    const session = await db.session.findUnique({
      where:   { refreshToken },
      include: { user: { select: { id: true, email: true, role: true, name: true, isActive: true } } },
    });

    if (!session || !session.user.isActive || session.expiresAt < new Date()) {
      return Response.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    // Rotate refresh token
    const newAccessToken  = await signAccessToken({ sub: String(session.user.id), email: session.user.email, role: session.user.role, name: session.user.name });
    const newRefreshToken = await signRefreshToken(session.user.id);

    await db.session.update({
      where: { id: session.id },
      data:  { refreshToken: newRefreshToken, expiresAt: refreshTokenExpiry() },
    });

    return Response.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    return Response.json({ error: "Invalid refresh token" }, { status: 401 });
  }
}
