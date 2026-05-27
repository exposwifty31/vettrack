import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Global API limiter: baseline protection for all /api/* requests.
export const globalApiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many API requests. Please wait a moment." },
});

// Scan actions: 10/min — POST /api/equipment/:id/scan
export const scanLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many scan actions. Please wait a moment." },
});

// Checkout/return: 20/min — POST /api/equipment/:id/checkout|return
export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout/return actions. Please wait a moment." },
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

export const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write operations. Please wait a moment." },
  // In test/CI mode the entire Playwright suite runs from a single IP against a
  // single server process, so sequential tests exhaust the per-IP window.
  // Skip limiting only when NODE_ENV=test or TEST_MODE=true; production is never
  // in either of those states.
  skip: () =>
    process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true",
});