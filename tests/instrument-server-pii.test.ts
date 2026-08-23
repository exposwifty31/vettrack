import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initSpy = vi.fn();

vi.mock("@sentry/node", () => ({
  init: initSpy,
  expressIntegration: vi.fn(() => ({})),
}));

describe("server Sentry init — PII", () => {
  beforeEach(() => {
    vi.resetModules();
    initSpy.mockClear();
    vi.stubEnv("SENTRY_DSN", "https://example@o0.ingest.sentry.io/0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never sends default PII (IP, cookies, request/response bodies) to Sentry", async () => {
    await import("../server/instrument");
    expect(initSpy).toHaveBeenCalledTimes(1);
    const config = initSpy.mock.calls[0][0];
    expect(config.sendDefaultPii).toBe(false);
  });
});
