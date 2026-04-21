// src/app/api/auth/logout/route.js
import { db }      from "@/lib/db";
import { cookies } from "next/headers";

export async function POST() {
  try {
    const cookieStore  = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;
    if (refreshToken) {
      await db.session.deleteMany({ where: { refreshToken } }).catch(() => {});
    }
    const expired = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 0 };
    cookieStore.set("access_token",  "", { ...expired, path: "/" });
    cookieStore.set("refresh_token", "", { ...expired, path: "/api/auth" });
  } catch {}
  return Response.json({ success: true });
}
