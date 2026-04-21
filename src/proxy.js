// src/proxy.js
// Next.js 16 renamed the "middleware" file convention to "proxy".
// This file is functionally identical to the old src/middleware.js —
// only the filename changed. The old src/middleware.js can be deleted.
import { NextResponse } from "next/server";
import { jwtVerify }    from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

const PUBLIC_PATHS = ["/api/auth/login", "/api/auth/refresh", "/login"];
const ADMIN_PATHS  = ["/api/users", "/api/reports", "/admin"];
const API_RE       = /^\/api\//;

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const cookieToken = request.cookies.get("access_token")?.value ?? null;
  const authHeader  = request.headers.get("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token       = cookieToken ?? headerToken ?? null;

  if (!token) {
    if (API_RE.test(pathname)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET);

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Invalid user ID in token");
    }

    if (ADMIN_PATHS.some(p => pathname.startsWith(p)) && payload.role !== "ADMIN") {
      if (API_RE.test(pathname)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/employee/dashboard", request.url));
    }

    const headers = new Headers(request.headers);
    headers.set("x-user-id",    String(userId));
    headers.set("x-user-role",  payload.role);
    headers.set("x-user-email", payload.email);
    headers.set("x-user-name",  payload.name);

    return NextResponse.next({ request: { headers } });
  } catch {
    if (API_RE.test(pathname)) {
      return NextResponse.json({ error: "Token expired or invalid" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("expired", "true");
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
