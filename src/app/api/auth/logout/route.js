// src/app/api/auth/logout/route.js
import { db }      from "@/lib/db";
import { cookies } from "next/headers";

export async function POST(request) {
  try {
    const { refreshToken } = await request.json();
    if (refreshToken) {
      await db.session.deleteMany({ where: { refreshToken } }).catch(() => {});
    }
  } catch {}

  // MINOR FIX: The login route now sets an httpOnly `access_token` cookie.
  // Logout must clear it so the middleware can no longer authenticate requests
  // using the old token — even if the client still holds it in localStorage.
  // Previously this cookie was left alive for its full 15-minute lifetime after
  // logout, meaning any request (e.g. a page refresh) would still be authenticated
  // via the cookie even after the user had clicked "Log out".
  try {
    const cookieStore = await cookies();
    cookieStore.set("access_token", "", {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",
      sameSite: "lax",
      maxAge:   0, // expire immediately
    });
  } catch {}

  return Response.json({ success: true });
}
