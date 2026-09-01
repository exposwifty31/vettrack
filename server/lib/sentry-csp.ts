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

  // ONLY the browser's DSN. server/instrument.ts sends from Node using
  // SENTRY_DSN, and CSP does not govern that — so adding its origin here would
  // widen the browser's allowlist for a request the browser never makes. The
  // two are normally the same host, where including it is a no-op; the only
  // case where it changes the header is the case where it is wrong.
  const dsn = env.VITE_SENTRY_DSN;
  if (dsn) {
    try {
      origins.add(new URL(dsn).origin);
    } catch {
      // A malformed DSN cannot yield an origin, and refusing to boot over it
      // would take the whole app down for a telemetry misconfiguration.
      // Sentry.init rejects the same value just as visibly. The value itself is
      // deliberately not logged — a DSN carries its public key.
      console.warn("[csp] VITE_SENTRY_DSN is malformed; its origin is not in connect-src");
    }
  }

  return [...origins];
}
