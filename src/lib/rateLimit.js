// src/lib/rateLimit.js
//
// Simple in-memory rate limiter using a Map.
//
// How it works:
//   - Each unique key (e.g. IP address) gets a bucket in the Map.
//   - Each bucket tracks: how many attempts have been made and when the
//     window started.
//   - If the attempt count exceeds MAX_ATTEMPTS within WINDOW_MS, the
//     request is blocked until the window expires and resets.
//
// Limitations (acceptable for a single-process Next.js app):
//   - State lives in process memory — resets on server restart.
//   - Does not share state across multiple server instances/workers.
//     For multi-instance deployments, replace the Map with Redis.
//   - The cleanup interval prevents unbounded memory growth by removing
//     expired buckets every CLEANUP_INTERVAL_MS.
//
// Configuration
const WINDOW_MS            = 15 * 60 * 1000; // 15-minute sliding window
const MAX_ATTEMPTS         = 10;              // max failed attempts per window
const BLOCK_DURATION_MS    = 30 * 60 * 1000; // 30 min block after limit hit
const CLEANUP_INTERVAL_MS  = 5  * 60 * 1000; // prune stale entries every 5 min

// bucket shape: { attempts, windowStart, blockedUntil }
const store = new Map();

// Periodic cleanup — removes entries whose block AND window have both expired
// so the Map doesn't grow forever on a long-running server.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    const windowExpired = now - bucket.windowStart > WINDOW_MS;
    const blockExpired  = !bucket.blockedUntil || now > bucket.blockedUntil;
    if (windowExpired && blockExpired) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Prevent the interval from keeping the Node process alive during tests
if (cleanupInterval.unref) cleanupInterval.unref();

/**
 * Check and record an attempt for the given key.
 *
 * @param {string} key        - Unique identifier, typically the client IP.
 * @param {boolean} success   - Pass true on a successful login to reset the
 *                              bucket (legitimate user shouldn't stay limited
 *                              after a correct password).
 * @returns {{
 *   allowed:     boolean,   // false → caller should return 429
 *   remaining:   number,    // attempts left before block
 *   retryAfter:  number,    // seconds until block lifts (0 if not blocked)
 * }}
 */
function rateLimit(key, success = false) {
  const now = Date.now();

  // ── Already blocked? ────────────────────────────────────────
  const bucket = store.get(key);
  if (bucket?.blockedUntil && now < bucket.blockedUntil) {
    const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  // ── Successful login → clear the bucket and allow ───────────
  if (success) {
    store.delete(key);
    return { allowed: true, remaining: MAX_ATTEMPTS, retryAfter: 0 };
  }

  // ── Window expired or first attempt → start a fresh window ──
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    store.set(key, { attempts: 1, windowStart: now, blockedUntil: null });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, retryAfter: 0 };
  }

  // ── Increment attempt counter ────────────────────────────────
  bucket.attempts += 1;

  if (bucket.attempts > MAX_ATTEMPTS) {
    // Threshold crossed — set or extend the block
    bucket.blockedUntil = now + BLOCK_DURATION_MS;
    const retryAfter    = Math.ceil(BLOCK_DURATION_MS / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  const remaining = MAX_ATTEMPTS - bucket.attempts;
  return { allowed: true, remaining, retryAfter: 0 };
}

/**
 * Extract the best available client IP from a Next.js Request object.
 * Handles common reverse-proxy headers (Vercel, Nginx, Cloudflare).
 *
 * Falls back to "unknown" if nothing is present — still rate-limited,
 * just under a shared bucket for headerless requests.
 */
function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")                             ||
    request.headers.get("cf-connecting-ip")                      ||
    "unknown"
  );
}

module.exports = { rateLimit, getClientIp, MAX_ATTEMPTS, WINDOW_MS, BLOCK_DURATION_MS };
