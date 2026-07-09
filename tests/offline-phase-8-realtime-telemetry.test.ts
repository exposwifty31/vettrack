/**
 * OFF-08 — POST /api/realtime/telemetry increments offline_sync_* counters.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { getMetricsSnapshot, incrementMetric, resetMetrics } from "../server/lib/metrics.js";

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

describe("OFF-08 realtime telemetry handler", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("increments pending depth counter for valid bucket", async () => {
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    const req = { body: { offlineSyncPendingCountBucket: "6_plus" }, headers: {} } as Request;
    const before = getMetricsSnapshot().offlineSync.pendingReported.sixPlus;
    handler(req, res);
    expect(captured.statusCode).toBe(200);
    expect(getMetricsSnapshot().offlineSync.pendingReported.sixPlus).toBe(before + 1);
  });

  it("increments all bucket families from one report", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    const req = {
      body: {
        offlineSyncPendingCountBucket: "1",
        offlineSyncOldestPendingAgeBucket: "lt_60s",
        offlineSyncDeadLetterBucket: "1",
        offlineSyncConflictBucket: "1_plus",
        offlineSyncSessionSuccessBucket: "1_5",
        offlineSyncSessionConflictBucket: "0",
        offlineSyncSessionDeadBucket: "6_plus",
      },
      headers: {},
    } as Request;
    handler(req, res);
    const snap = getMetricsSnapshot();
    expect(snap.offlineSync.pendingReported.one).toBe(1);
    expect(snap.offlineSync.oldestPendingAge.lt60s).toBe(1);
    expect(snap.offlineSync.deadLetter.one).toBe(1);
    expect(snap.offlineSync.conflict.onePlus).toBe(1);
    expect(snap.offlineSync.sessionSuccess.oneToFive).toBe(1);
    expect(snap.offlineSync.sessionConflict.zero).toBe(1);
    expect(snap.offlineSync.sessionDead.sixPlus).toBe(1);
  });

  it("rejects invalid enum with telemetry_payload_rejected_enum_mismatch", async () => {
    const handler = await loadTelemetryHandler();
    const { res } = makeRes();
    const before = getMetricsSnapshot().phase9Observability.telemetryPayloadRejected.enumMismatch;
    handler({ body: { offlineSyncPendingCountBucket: "999" }, headers: {} } as Request, res);
    expect(getMetricsSnapshot().phase9Observability.telemetryPayloadRejected.enumMismatch).toBe(
      before + 1,
    );
    expect(getMetricsSnapshot().offlineSync.pendingReported.zero).toBe(0);
  });

  it("exposes offlineSync on getMetricsSnapshot", () => {
    incrementMetric("offline_sync_dead_letter_two_plus");
    expect(getMetricsSnapshot().offlineSync.deadLetter.twoPlus).toBe(1);
  });
});
