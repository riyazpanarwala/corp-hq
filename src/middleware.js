// src/middleware.js
// jose v6: jwtVerify import and usage are identical to v5. No changes needed.
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

  // Token priority:
  //   1. httpOnly access_token cookie (set at login, XSS-safe)
  //   2. Authorization header (used by authFetch for client-side API calls)
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

    // Validate sub before forwarding it as a trusted header.
    // payload.sub is a string by JWT spec; reject anything that doesn't
    // round-trip cleanly to a positive integer.
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Invalid user ID in token");
    }

    // RBAC
    if (ADMIN_PATHS.some(p => pathname.startsWith(p)) && payload.role !== "ADMIN") {
      if (API_RE.test(pathname)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/employee/dashboard", request.url));
    }

    // Forward validated user info to API route handlers via headers
    const headers = new Headers(request.headers);
    headers.set("x-user-id",    String(userId));   // forwarded as validated integer string
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
