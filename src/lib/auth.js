// src/lib/auth.js
const { SignJWT, jwtVerify } = require("jose");

const ACCESS_SECRET  = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRY  || "15m";
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "7d";

// ── Sign ──────────────────────────────────────────────────────
async function signAccessToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRY)
    .sign(ACCESS_SECRET);
}

async function signRefreshToken(userId) {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRY)
    .sign(REFRESH_SECRET);
}

// ── Verify ────────────────────────────────────────────────────
async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, ACCESS_SECRET);
  return payload;
}

async function verifyRefreshToken(token) {
  const { payload } = await jwtVerify(token, REFRESH_SECRET);
  return payload;
}

// ── Extract from header ───────────────────────────────────────
function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

// ── Get current user from forwarded headers (set by middleware) ─
//
// Previously used parseInt(userId) which has two problems:
//   1. parseInt("1.5") === 1 — silently truncates floats.
//   2. parseInt("abc") === NaN — causes Prisma to throw an unhandled
//      error that can leak stack traces in responses.
//
// Number() + Number.isInteger() rejects both cases explicitly.
function getCurrentUser(request) {
  const rawId = request.headers.get("x-user-id");
  const id    = Number(rawId);

  if (!rawId || !Number.isInteger(id) || id <= 0) {
    throw new ApiError("Unauthenticated", 401);
  }

  return {
    id,
    role:  request.headers.get("x-user-role"),
    email: request.headers.get("x-user-email"),
    name:  request.headers.get("x-user-name"),
  };
}

// ── Refresh token expiry (7 days from now) ────────────────────
function refreshTokenExpiry() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

// ── Typed API error ───────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name   = "ApiError";
    this.status = status;
    this.code   = code;
  }
}

function handleApiError(err) {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[API Error]", err);
  return Response.json({ error: err.message || "Server error" }, { status: 400 });
}

module.exports = {
  signAccessToken, signRefreshToken,
  verifyAccessToken, verifyRefreshToken,
  extractBearerToken, getCurrentUser,
  refreshTokenExpiry, ApiError, handleApiError,
};
