/**
 * SYNC-TEL — POST /api/realtime/telemetry for sync engine event signals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
  requireDisplayOrUser: (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));

type Captured = { statusCode: number; body: Record<string, unknown> };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: {} };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
  } as unknown as Response;
  return { res, captured };
}

async function loadTelemetryHandler(): Promise<
  (req: Request, res: Response) => void
> {
  const { default: router } = await import("../server/routes/realtime.js");
  const stack = router as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      };
    }>;
  };
  const layer = stack.stack.find(
    (l) => l.route?.path === "/telemetry" && l.route.methods.post,
  );
  if (!layer?.route) throw new Error("POST /telemetry handler not found");
  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

describe("SYNC-TEL realtime telemetry handler", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("increments offline_sync_permanent_failure for syncPermanentFailure: true", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    handler({ body: { syncPermanentFailure: true }, headers: {} } as Request, res);
    expect(getMetricsSnapshot().offlineSync.engine.permanentFailure).toBe(1);
    expect(getMetricsSnapshot().offlineSync.engine.circuitOpen).toBe(0);
  });

  it("increments offline_sync_circuit_open for syncCircuitOpen: true", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    handler({ body: { syncCircuitOpen: true }, headers: {} } as Request, res);
    expect(getMetricsSnapshot().offlineSync.engine.circuitOpen).toBe(1);
    expect(getMetricsSnapshot().offlineSync.engine.permanentFailure).toBe(0);
  });

  it("rejects non-boolean syncPermanentFailure with enum mismatch", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    const before = getMetricsSnapshot().phase9Observability.telemetryPayloadRejected.enumMismatch;
    handler({ body: { syncPermanentFailure: "true" }, headers: {} } as Request, res);
    expect(getMetricsSnapshot().phase9Observability.telemetryPayloadRejected.enumMismatch).toBe(
      before + 1,
    );
    expect(getMetricsSnapshot().offlineSync.engine.permanentFailure).toBe(0);
  });

  it("rejects non-boolean syncCircuitOpen with enum mismatch", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    handler({ body: { syncCircuitOpen: 1 }, headers: {} } as Request, res);
    expect(getMetricsSnapshot().offlineSync.engine.permanentFailure).toBe(0);
    expect(getMetricsSnapshot().offlineSync.engine.circuitOpen).toBe(0);
    expect(getMetricsSnapshot().phase9Observability.telemetryPayloadRejected.enumMismatch).toBe(1);
  });
});
