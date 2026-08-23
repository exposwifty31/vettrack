import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initSpy = vi.fn();

vi.mock("@sentry/react", () => ({
  init: initSpy,
  browserTracingIntegration: vi.fn(() => ({})),
  replayIntegration: vi.fn(() => ({})),
  captureException: vi.fn(),
}));

describe("client Sentry init — PII", () => {
  const prevDsn = import.meta.env.VITE_SENTRY_DSN;

  beforeEach(() => {
    vi.resetModules();
    initSpy.mockClear();
    import.meta.env.VITE_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
  });

  afterEach(() => {
    import.meta.env.VITE_SENTRY_DSN = prevDsn;
  });

  it("never sends default PII (IP, cookies, request bodies) to Sentry", async () => {
    await import("../src/instrument");
    expect(initSpy).toHaveBeenCalledTimes(1);
    const config = initSpy.mock.calls[0][0];
    expect(config.sendDefaultPii).toBe(false);
  });
});
