/**
 * The CSP origins the browser must be allowed to reach for Sentry to work.
 *
 * `Sentry.init()` succeeding tells you nothing about whether events arrive: the
 * SDK posts envelopes to the DSN's origin, and if `connect-src` does not list
 * that origin the browser refuses every send. The SDK treats the refusal as an
 * ordinary transport error and stays quiet, so the app looks instrumented and
 * reports nothing.
 *
 * These are derived from the DSNs rather than written out, so the allowlist
 * cannot drift from the DSN actually in use — the failure mode that produced
 * this file in the first place.
 */
export function sentryIngestOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>();

  // VITE_SENTRY_DSN is the browser's; SENTRY_DSN is the server's. Only the
  // browser is subject to CSP, but both are included because they are normally
  // the same host and a mismatch is worth allowing rather than debugging.
  for (const dsn of [env.VITE_SENTRY_DSN, env.SENTRY_DSN]) {
    if (!dsn) continue;
    try {
      origins.add(new URL(dsn).origin);
    } catch {
      // A malformed DSN cannot yield an origin, and refusing to boot over it
      // would take the whole app down for a telemetry misconfiguration.
      // Sentry.init rejects the same value just as visibly.
      console.warn("[csp] ignoring malformed Sentry DSN; its origin is not in connect-src");
    }
  }

  return [...origins];
}
