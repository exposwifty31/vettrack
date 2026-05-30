/**
 * Codex P2 — internal watchdog must authenticate to /health/data-integrity when
 * DATA_INTEGRITY_HEALTH_TOKEN is set (production fail-closed contract).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const originalToken = process.env.DATA_INTEGRITY_HEALTH_TOKEN;

describe("alert-engine data-integrity fetch auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "ok", totals: {} }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;
    else process.env.DATA_INTEGRITY_HEALTH_TOKEN = originalToken;
  });

  it("sends x-health-token when DATA_INTEGRITY_HEALTH_TOKEN is configured", async () => {
    process.env.DATA_INTEGRITY_HEALTH_TOKEN = "watchdog-test-token";
    const { evaluateAlerts, resetAlertEngineForTests } = await import("../server/lib/alert-engine.js");
    resetAlertEngineForTests();

    await evaluateAlerts({ thresholds: { accessDeniedPerMinute: 9999 } });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({ "x-health-token": "watchdog-test-token" });
  });

  it("omits x-health-token when token is unset (dev / non-production)", async () => {
    delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;
    const { evaluateAlerts, resetAlertEngineForTests } = await import("../server/lib/alert-engine.js");
    resetAlertEngineForTests();

    await evaluateAlerts({ thresholds: { accessDeniedPerMinute: 9999 } });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers ?? {}).not.toHaveProperty("x-health-token");
  });
});
