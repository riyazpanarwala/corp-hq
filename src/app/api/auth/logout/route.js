// src/app/api/auth/logout/route.js
import { db } from "@/lib/db";

export async function POST(request) {
  try {
    const { refreshToken } = await request.json();
    if (refreshToken) {
      await db.session.deleteMany({ where: { refreshToken } }).catch(() => {});
    }
  } catch {}
  return Response.json({ success: true });
}
