import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // sendDefaultPii would attach the raw request cookies (including the
    // live Clerk session), all HTTP headers, and full request/response
    // bodies to every captured event by default (Sentry docs: deprecated
    // in favor of explicit dataCollection categories). User context is
    // already set explicitly via Sentry.setUser in server/middleware/auth.ts.
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    integrations: [Sentry.expressIntegration()],
  });
}
