process.on("uncaughtException", (e) => console.error("💥 FATAL ERROR:", e));
process.on("unhandledRejection", (r) =>
  console.error("💥 UNHANDLED PROMISE:", r),
);

// MUST be first — populates process.env from .env.local + .env before any
// other module is evaluated (e.g. ./lib/envValidation, ./db which read
// DATABASE_URL / SMTP_* at import time).
import "./lib/env-bootstrap.js";
// Sentry init reads SENTRY_DSN from env — must follow env-bootstrap.
import "./instrument.js";

import { validateEnv } from "./lib/envValidation.js";
validateEnv();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import xss from "xss";
import { clerkMiddleware } from "@clerk/express";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runMigrations } from "./migrate.js";
import { globalApiLimiter } from "./middleware/rate-limiters.js";
import { i18nMiddleware } from "../lib/i18n/middleware.js";
import { tenantContext } from "./middleware/tenant-context.js";
import { sessionContextMiddleware } from "./middleware/auth.js";
import { registerApiRoutes } from "./app/routes.js";
import clerkWebhookRoutes from "./routes/webhooks.js";
import inboundIntegrationWebhooks from "./integrations/webhooks/inbound.router.js";
import rfidRoutes from "./routes/rfid.js";
import { mountRfidRoutes } from "./lib/mount-rfid-routes.js";
import { startBackgroundSchedulers } from "./app/start-schedulers.js";
import { ensureClinicPhase2Defaults } from "./lib/ensure-clinic-phase2-defaults.js";
import healthRoutes from "./routes/health.js";
import { resolveAuthModeFromEnv, describeAuthMode } from "./lib/auth-mode.js";
import {
  loadBuildInfo,
  resolveBackendPilotMode,
  resolveFrontendPilotMode,
} from "./lib/build-info.js";

const { version: appVersion } = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf-8")) as { version?: string };
const isProduction = process.env.NODE_ENV === "production";

const app = express();
// Deployment runs behind a reverse proxy that sets X-Forwarded-For.
// Trust first proxy so rate limiting derives client IPs correctly.
app.set("trust proxy", 1);

// Health checks must bypass all middleware (CORS, Clerk, CSP, body parsing, etc.).
function sendHealthOk(_req: express.Request, res: express.Response) {
  res.status(200).send("ok");
}
app.use("/api/health", healthRoutes);
app.get("/api/healthz", sendHealthOk);
app.get("/api/version", (_req, res) => {
  const buildInfo = loadBuildInfo();
  const backendPilotMode = resolveBackendPilotMode();
  const frontendPilotMode = resolveFrontendPilotMode();
  res.status(200).json({
    version: appVersion ?? "0.0.0",
    buildTag: buildInfo?.buildTag ?? null,
    gitCommit:
      buildInfo?.gitCommit ??
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ??
      process.env.GITHUB_SHA?.trim() ??
      null,
    builtAt: buildInfo?.builtAt ?? null,
    pilotMode: {
      backend: backendPilotMode,
      frontend: frontendPilotMode,
      /** True when compile-time and runtime pilot flags disagree (stale deploy or misconfigured env). */
      mismatch:
        frontendPilotMode !== null && frontendPilotMode !== backendPilotMode,
    },
  });
});

function hasInvalidHeaderChars(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

function hasNonAsciiHeaderChars(value: string): boolean {
  return /[^\x20-\x7E]/.test(value);
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || hasInvalidHeaderChars(trimmed) || hasNonAsciiHeaderChars(trimmed)) return null;
  try {
    const normalized = new URL(trimmed).origin;
    if (hasInvalidHeaderChars(normalized) || hasNonAsciiHeaderChars(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

/** Capacitor bundled-shell WebView origins (cross-origin API calls from native app). */
const CAPACITOR_WEBVIEW_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
]);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://clerk.vettrack.uk",
          "https://*.clerk.accounts.dev",
          "https://static.cloudflareinsights.com",
          ...(isProduction ? [] : ["'unsafe-eval'"]),
        ],
        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://clerk.vettrack.uk",
          "https://*.clerk.accounts.dev",
          "https://static.cloudflareinsights.com",
          ...(isProduction ? [] : ["'unsafe-eval'"]),
        ],
        connectSrc: [
          "'self'",
          "https://clerk.vettrack.uk",
          "https://*.clerk.accounts.dev",
          "https://api.clerk.dev",
          "https://clerk.dev",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://clerk.vettrack.uk",
          ...(isProduction ? [] : ["'unsafe-eval'"]),
        ],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://clerk.vettrack.uk",
          ...(isProduction ? [] : ["'unsafe-eval'"]),
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "https://clerk.vettrack.uk", "https://*.clerk.accounts.dev"],
        workerSrc: ["'self'", "blob:", "https://clerk.vettrack.uk"],
        scriptSrcAttr: isProduction ? ["'unsafe-inline'"] : ["'unsafe-inline'", "'unsafe-eval'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      try {
        // Capacitor/Ionic schemes are non-special per the WHATWG URL spec, so
        // `new URL("capacitor://localhost").origin` is the literal string "null"
        // — match the raw header against the fixed allowlist before normalizing.
        const rawOrigin = origin?.trim();
        if (isProduction && rawOrigin && CAPACITOR_WEBVIEW_ORIGINS.has(rawOrigin)) {
          callback(null, rawOrigin);
          return;
        }

        const requestOrigin = normalizeOrigin(origin);
        if (!requestOrigin) {
          callback(null, false);
          return;
        }

        // In development allow any localhost / 127.0.0.1 origin so that direct
        // API calls from browser devtools and API testing tools work without
        // needing ALLOWED_ORIGIN set to a specific localhost port.
        if (!isProduction) {
          try {
            const parsed = new URL(requestOrigin);
            if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
              callback(null, requestOrigin);
              return;
            }
          } catch {
            // fall through to ALLOWED_ORIGIN check
          }
        }

        const allowedOrigin = normalizeOrigin(process.env.ALLOWED_ORIGIN);
        if (!allowedOrigin) {
          callback(null, false);
          return;
        }

        const allowedWithWww = allowedOrigin.replace("://", "://www.");
        const isAllowed =
          requestOrigin === allowedOrigin || requestOrigin === allowedWithWww;
        if (!isAllowed) {
          callback(null, false);
          return;
        }
        callback(null, requestOrigin === allowedWithWww ? allowedWithWww : allowedOrigin);
      } catch (error) {
        console.warn("CORS origin validation failed, denying request origin", error);
        callback(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(
  compression({
    // SSE (GET /api/realtime/stream) must not be buffered by gzip.
    filter: (req, res) => {
      const path = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
      if (path.includes("/api/realtime/stream")) return false;
      return compression.filter(req, res);
    },
  }),
);

// Clerk webhook MUST be mounted before express.json() so the raw body is
// available for svix signature verification.
app.use("/api/webhooks/clerk", clerkWebhookRoutes);

// PMS / integration vendor webhooks — HMAC over raw body (Phase B Sprint 4).
app.use(
  "/api/integration-webhooks/:adapterId",
  express.raw({ type: () => true, limit: "512kb" }),
  inboundIntegrationWebhooks,
);

mountRfidRoutes(app, "/api/rfid", () => rfidRoutes);

app.use(express.json());

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return xss(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(nestedValue);
    }
    return sanitized;
  }
  return value;
}

// Global request body sanitization (keeps route-level Zod validation intact).
app.use((req, _res, next) => {
  req.body = sanitizeValue(req.body) as Record<string, unknown>;
  next();
});

// Always mount official Clerk middleware at app level when Clerk auth is enabled.
// In dev bypass mode (no secret), requireAuth falls back to local dev identity.
const authModeResolution = resolveAuthModeFromEnv();

// Secret-free startup banner so operators and agents can confirm the server
// auth mode without reading env files. Logged once at boot (non-production).
if (!isProduction) {
  console.log(`[auth-mode] server ${describeAuthMode(authModeResolution)}`);
}

if (authModeResolution.mode === "clerk") {
  if (!process.env.CLERK_PUBLISHABLE_KEY?.trim() && process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  }
  app.use(clerkMiddleware());
}

// Global API limiter runs before route-specific limiters.
app.use("/api", globalApiLimiter);
app.use("/api", i18nMiddleware);
app.use("/api", tenantContext);
app.use("/api", sessionContextMiddleware);

registerApiRoutes(app);

// Apple App Site Association — enables iOS Universal Links for applinks:vettrack.uk.
// Registered unconditionally (so dev also serves it) and BEFORE the production static/
// catch-all block so it wins over the SPA `app.get("*")`. Must be application/json and
// must NOT redirect — Apple's CDN fetches /.well-known/apple-app-site-association directly.
app.get("/.well-known/apple-app-site-association", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=UTF-8");
  res.setHeader("Cache-Control", "no-cache");
  res.json({
    applinks: {
      details: [
        {
          appIDs: ["87F5G378M6.uk.vettrack.app"],
          components: [{ "/": "/equipment/*", comment: "Equipment checkout/return deep links" }],
        },
      ],
    },
  });
});

if (process.env.NODE_ENV === "production" || process.env.PLAYWRIGHT_E2E === "true") {
  // Vite content-hashed assets: safe to cache indefinitely (new content = new URL).
  app.use(
    "/assets",
    express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/public/assets"), {
      maxAge: "1y",
      immutable: true,
    })
  );
  // Service worker: MUST never be cached by browsers or CDNs. If an edge
  // (Cloudflare / Fastly) or browser HTTP cache pins an old /sw.js, clients
  // get stuck re-installing the stale worker on every load. The dedicated
  // route below wins over the static middleware and the SPA catch-all, and
  // handles both `/sw.js` and `/sw.js?v=<version>` cache-busted URLs.
  app.get("/sw.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
    res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/public/sw.js"));
  });
  // Manifest: iOS Safari requires application/manifest+json (not application/json).
  // Without the correct MIME type iOS does not recognise the file as a web-app
  // manifest and "Add to Home Screen" falls back to a plain bookmark.
  app.get("/manifest.json", (_req, res) => {
    res.setHeader("Content-Type", "application/manifest+json; charset=UTF-8");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/public/manifest.json"));
  });
  // Everything else (icons, etc.): short cache.
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/public"), { maxAge: 0 }));
  // SPA shell: never cache — browsers must always get the latest index.html
  // so they pick up new content-hashed asset filenames after a deployment.
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/public/index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled application error", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal Server Error" });
});

function resolvePort(value: string | undefined): number {
  if (!value || value.trim() === "") return 3001;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return 3001;
  return parsed;
}


function startResilientInterval(params: {
  name: string;
  intervalMs: number;
  task: () => Promise<void>;
  retryBaseMs?: number;
  maxRetryMs?: number;
}): void {
  let inFlight = false;
  let failureCount = 0;
  let lastLogAt = 0;

  const runOnce = () => {
    if (inFlight) return;
    inFlight = true;
    void params.task().then(() => {
      failureCount = 0;
    }).catch((err) => {
      failureCount += 1;
      const base = params.retryBaseMs ?? 500;
      const max = params.maxRetryMs ?? 60_000;
      const backoff = Math.min(max, base * 2 ** Math.max(0, failureCount - 1));
      const jitter = Math.round(backoff * (0.5 + Math.random()));
      const now = Date.now();
      if (now - lastLogAt > 30_000) {
        lastLogAt = now;
        console.error(`[${params.name}] failed; retrying in ~${jitter}ms`, err);
      }
      setTimeout(() => {
        if (!inFlight) runOnce();
      }, jitter);
    }).finally(() => {
      inFlight = false;
    });
  };

  runOnce();
  setInterval(runOnce, params.intervalMs);
}

const isTestMode = process.env.NODE_ENV === "test";
const PORT = resolvePort(process.env.PORT);
app.listen(PORT, "0.0.0.0", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("ENV PORT =", process.env.PORT);
  }
  console.log(`Server listening on ${PORT}`);
});

runMigrations()
  .then(async () => {
    // ensureClinicPhase2Defaults always runs — test suites that touch the DB
    // need the dev-clinic-default row to exist after migrations.
    try {
      await ensureClinicPhase2Defaults();
      console.log("✅ Clinic billing / inventory defaults ensured");
    } catch (err) {
      console.error("Clinic Phase 2 defaults failed (non-fatal)", err);
    }

    if (isTestMode) {
      console.log("[test-mode] Background schedulers, recovery jobs, and ER cache preload disabled");
      return;
    }

    startBackgroundSchedulers().catch((err) => {
      console.error("Failed to initialize push notifications", err);
    });
    console.log("✅ Background schedulers started");

  })
  .catch((err) => {
    console.error("💥 Migration failed, aborting scheduler start", err);
  });
