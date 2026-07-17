import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { readRfidClinicId } from "../lib/rfid/clinic-header.js";

// Audit (2026-06-10): GLOBAL reduced from 6_000 to 100 (per-IP backstop).
// Per-user limiters (scan/checkout/write) remain at 600 — test contract
// tests/rate-limiters-f2.test.ts requires >= 100 per user, and ward scenarios
// with high NFC scan throughput require headroom above 20/min.
/** F2 — per-minute ceilings (DoS backstop; normal ward use stays well below). */
export const SCAN_LIMITER_MAX_PER_MINUTE = 600;
export const CHECKOUT_LIMITER_MAX_PER_MINUTE = 600;
export const WRITE_LIMITER_MAX_PER_MINUTE = 600;
export const GLOBAL_API_LIMITER_MAX_PER_MINUTE = 100;

/**
 * Playwright CI serves the API via `pnpm dev:api` (NODE_ENV=development) so
 * background schedulers + SSE outbox stay live. Per-IP throttles must still
 * be relaxed for that runtime — see PLAYWRIGHT_E2E in playwright.yml.
 */
export function shouldSkipPerIpApiThrottles(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.TEST_MODE === "true" ||
    process.env.PLAYWRIGHT_E2E === "true"
  );
}

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
  skip: shouldSkipPerIpApiThrottles,
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
// RFID doorway ingest: 120/min per clinic+IP.
//
// Per-clinic keying reads the canonical two-`t` `x-vettrack-clinic` header (the
// spelling the signer/brand emit — Node lowercases `X-VetTrack-*` on the wire).
// Two clinics behind one IP get independent 120/min buckets; the per-IP tail
// only applies when the clinic header is truly absent.
export function rfidEventLimiterKey(req: Request): string {
  const clinicId = readRfidClinicId(req);
  const ip = ipKeyGenerator(req.ip ?? "127.0.0.1");
  return `${clinicId}:${ip}`;
}

export const rfidEventLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many RFID events. Please wait a moment." },
  keyGenerator: rfidEventLimiterKey,
  skip: shouldSkipPerIpApiThrottles,
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
  skip: shouldSkipPerIpApiThrottles,
});