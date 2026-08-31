import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sentryIngestOrigins } from "../server/lib/sentry-csp";

/**
 * Sentry.init running is not the same as Sentry working.
 *
 * On 2026-08-31, after `VITE_SENTRY_DSN` was finally passed into the Docker
 * build (PR #274), the browser console showed the SDK POSTing envelopes to
 * `o4511187398950912.ingest.de.sentry.io` — and every one of them refused:
 *
 *   Fetch API cannot load https://o…ingest.de.sentry.io/api/…/envelope/…
 *   Refused to connect because it violates the document's Content Security Policy.
 *
 * `connectSrc` in `server/index.ts` listed 'self' and four Clerk hosts. The web
 * app was still fully crash-blind, one layer deeper than before, and nothing
 * failed loudly enough to notice: the SDK swallows transport errors by design.
 *
 * The origin is DERIVED from the DSN rather than written out, because a
 * hardcoded host is exactly the kind of second copy that drifts — which is the
 * same failure this whole sequence started with.
 */
describe("Sentry ingest origins for CSP connect-src", () => {
  const CLIENT = "https://35eb35361dd40afd7048b8837a070245@o4511187398950912.ingest.de.sentry.io/4511187488604240";
  const SERVER = "https://abc123@o4511187398950912.ingest.de.sentry.io/4511187488604240999";

  it("derives the ingest origin the browser actually posts to", () => {
    expect(sentryIngestOrigins({ VITE_SENTRY_DSN: CLIENT })).toEqual([
      "https://o4511187398950912.ingest.de.sentry.io",
    ]);
  });

  it("drops the DSN's secret key — only the origin reaches the header", () => {
    const [origin] = sentryIngestOrigins({ VITE_SENTRY_DSN: CLIENT });
    expect(origin).not.toContain("35eb35361dd40afd7048b8837a070245");
    expect(origin).not.toContain("@");
  });

  it("ignores SENTRY_DSN even when it matches — one source, not two", () => {
    expect(sentryIngestOrigins({ VITE_SENTRY_DSN: CLIENT, SENTRY_DSN: SERVER })).toEqual([
      "https://o4511187398950912.ingest.de.sentry.io",
    ]);
  });

  /**
   * The server's Sentry client posts from Node (`server/instrument.ts` reads
   * SENTRY_DSN), and CSP governs the BROWSER only. Deriving from both would
   * widen connect-src for a request the browser never makes — and because the
   * two are normally the same host, the only case where including it changes
   * the header at all is the case where it is wrong. Raised by review on #275.
   */
  it("does not widen connect-src to a server-only origin the browser never posts to", () => {
    const origins = sentryIngestOrigins({
      VITE_SENTRY_DSN: CLIENT,
      SENTRY_DSN: "https://k@o999.ingest.us.sentry.io/1",
    });
    expect(origins).toEqual(["https://o4511187398950912.ingest.de.sentry.io"]);
    expect(origins).not.toContain("https://o999.ingest.us.sentry.io");
  });

  it("allows nothing when only the server DSN is set", () => {
    expect(sentryIngestOrigins({ SENTRY_DSN: SERVER })).toEqual([]);
  });

  it("allows nothing when no DSN is configured — no needless CSP allowance", () => {
    expect(sentryIngestOrigins({})).toEqual([]);
  });

  it("ignores a malformed DSN rather than refusing to boot", () => {
    expect(sentryIngestOrigins({ VITE_SENTRY_DSN: "not-a-url" })).toEqual([]);
  });

  it("REGRESSION: connect-src is wired to the derived origins, not a hardcoded host", () => {
    const serverIndex = readFileSync(resolve(__dirname, "../server/index.ts"), "utf8");
    const connectSrcBlock =
      serverIndex.match(/connectSrc:\s*\[([\s\S]*?)\],\s*\n\s*imgSrc:/)?.[1] ?? "";

    expect(connectSrcBlock, "connectSrc block not found in server/index.ts").not.toBe("");
    expect(
      connectSrcBlock,
      "connect-src does not spread the derived Sentry ingest origins — a Sentry envelope would be refused by CSP",
    ).toMatch(/\.\.\.sentryIngestOrigins/);
    expect(
      connectSrcBlock,
      "the ingest host is hardcoded; derive it from the DSN so the two cannot drift",
    ).not.toMatch(/ingest\.[a-z]{2}\.sentry\.io/);
  });
});
