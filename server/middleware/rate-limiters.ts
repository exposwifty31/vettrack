import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/** F2 — per-minute ceilings (DoS backstop; normal ward use stays well below). */
export const SCAN_LIMITER_MAX_PER_MINUTE = 600;
export const CHECKOUT_LIMITER_MAX_PER_MINUTE = 600;
export const WRITE_LIMITER_MAX_PER_MINUTE = 600;
export const GLOBAL_API_LIMITER_MAX_PER_MINUTE = 6_000;

/** F2 — per-user bucket when auth is present; shared-IP clinics otherwise fall back to IP. */
export function rateLimitUserKey(req: Request): string {
  const userId = req.authUser?.id;
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "127.0.0.1")}`;
}

// Global API limiter: per-IP backstop for all /api/* (DoS shield, not per-clinic UX throttle).
export const globalApiLimiter = rateLimit({
  windowMs: 60_000,
  max: GLOBAL_API_LIMITER_MAX_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many API requests. Please wait a moment." },
});

// Scan actions — generous per-user ceiling (equipment pilot hot path).
export const scanLimiter = rateLimit({
  windowMs: 60_000,
  max: SCAN_LIMITER_MAX_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many scan actions. Please wait a moment." },
  keyGenerator: rateLimitUserKey,
});

// Checkout/return — per-user; mirrors scan limiter headroom.
export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  max: CHECKOUT_LIMITER_MAX_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout/return actions. Please wait a moment." },
  keyGenerator: rateLimitUserKey,
});

// Auth/sensitive: 5/min — push subscribe, user creation
export const authSensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests on this endpoint. Please wait a minute." },
});

// Push test: 3/min per IP — prevents notification spam via self-targeted test
export const pushTestLimiter = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many test notifications. Please wait a minute." },
});
// Write operations: 30/min — POST/PATCH/DELETE on equipment
// RFID doorway ingest: 120/min per clinic+IP
export const rfidEventLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many RFID events. Please wait a moment." },
  keyGenerator: (req) => {
    const clinicHeader = req.headers["x-vetrack-clinic"];
    const clinicId =
      typeof clinicHeader === "string"
        ? clinicHeader.trim()
        : Array.isArray(clinicHeader)
          ? clinicHeader[0]?.trim() ?? ""
          : "";
    const ip = ipKeyGenerator(req.ip ?? "127.0.0.1");
    return `${clinicId}:${ip}`;
  },
  skip: () =>
    process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true",
});

/** Equipment intelligence (OpenAI-backed) — 12 requests/min per user. */
export const intelligenceLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many intelligence requests. Please wait a moment." },
  keyGenerator: rateLimitUserKey,
  skip: () =>
    process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true",
});

export const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: WRITE_LIMITER_MAX_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write operations. Please wait a moment." },
  keyGenerator: rateLimitUserKey,
  // In test/CI mode the entire Playwright suite runs from a single IP against a
  // single server process, so sequential tests exhaust the per-IP window.
  // Skip limiting only when NODE_ENV=test or TEST_MODE=true; production is never
  // in either of those states.
  skip: () =>
    process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true",
});