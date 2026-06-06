// src/lib/rateLimit.js
//
// In-memory rate limiter using a Map.
//
// API:
//   peek(key)    — check current state WITHOUT incrementing (use at the top of
//                  a handler to reject already-blocked IPs before doing work)
//   consume(key) — record one failed attempt and return new state
//   reset(key)   — clear bucket on successful auth
//
// This split ensures only confirmed credential failures count against the
// limit.  Parsing errors, DB failures, or any other server-side exception
// never burn an attempt.
//
// Limitations (single-process):
//   - State resets on server restart.
//   - Not shared across multiple Node workers/instances.
//     Replace the Map with Redis for multi-instance deployments.

const WINDOW_MS           = 15 * 60 * 1000; // 15-min sliding window
const MAX_ATTEMPTS        = 10;              // failed attempts before block
const BLOCK_DURATION_MS   = 30 * 60 * 1000; // 30-min block after limit hit
const CLEANUP_INTERVAL_MS =  5 * 60 * 1000; // prune stale buckets every 5 min

// bucket shape: { attempts: number, windowStart: number, blockedUntil: number|null }
const store = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBucket(key) {
  return store.get(key) ?? null;
}

function isBlocked(bucket, now) {
  return bucket?.blockedUntil != null && now < bucket.blockedUntil;
}

function retryAfterSeconds(bucket, now) {
  if (!bucket?.blockedUntil) return 0;
  return Math.ceil((bucket.blockedUntil - now) / 1000);
}

// ── Periodic cleanup ──────────────────────────────────────────────────────────

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    const windowExpired = now - bucket.windowStart > WINDOW_MS;
    const blockExpired  = !bucket.blockedUntil || now > bucket.blockedUntil;
    if (windowExpired && blockExpired) store.delete(key);
  }
}, CLEANUP_INTERVAL_MS);

if (cleanupInterval.unref) cleanupInterval.unref();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * peek(key) — read-only check. Does NOT increment the attempt counter.
 * Use at the very start of a handler to gate already-blocked clients
 * before doing any real work (DB queries, bcrypt, etc.).
 *
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
function peek(key) {
  const now    = Date.now();
  const bucket = getBucket(key);

  if (isBlocked(bucket, now)) {
    return { allowed: false, remaining: 0, retryAfter: retryAfterSeconds(bucket, now) };
  }

  const attempts  = bucket && (now - bucket.windowStart <= WINDOW_MS) ? bucket.attempts : 0;
  const remaining = Math.max(0, MAX_ATTEMPTS - attempts);
  return { allowed: true, remaining, retryAfter: 0 };
}

/**
 * consume(key) — record one failed attempt.
 * Call ONLY after a confirmed credential failure (wrong password).
 * Never call on parsing errors, DB failures, or other server exceptions.
 *
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
function consume(key) {
  const now    = Date.now();
  const bucket = getBucket(key);

  // Already blocked — return current state without extending the block
  if (isBlocked(bucket, now)) {
    return { allowed: false, remaining: 0, retryAfter: retryAfterSeconds(bucket, now) };
  }

  // Window expired or first attempt → fresh bucket
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    store.set(key, { attempts: 1, windowStart: now, blockedUntil: null });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, retryAfter: 0 };
  }

  // Increment within existing window
  bucket.attempts += 1;

  if (bucket.attempts >= MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_DURATION_MS;
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000) };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - bucket.attempts, retryAfter: 0 };
}

/**
 * reset(key) — clear the bucket after a successful login.
 * Ensures a legitimate user who had some prior failed attempts isn't blocked.
 */
function reset(key) {
  store.delete(key);
}

/**
 * getClientIp(request) — extract the best available client IP.
 * Handles Vercel, Nginx, and Cloudflare reverse-proxy headers.
 */
function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")                             ||
    request.headers.get("cf-connecting-ip")                      ||
    "unknown"
  );
}

module.exports = { peek, consume, reset, getClientIp, MAX_ATTEMPTS, WINDOW_MS, BLOCK_DURATION_MS };
