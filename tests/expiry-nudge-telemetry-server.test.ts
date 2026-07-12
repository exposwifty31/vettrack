/**
 * T-30a2-i — POST /api/realtime/telemetry: server-side closed enum for
 * `nudgeShown` ("expiry" | "restock"). Mirrors the existing
 * codeBluePropagationBucket / ALLOWED_CB_PROPAGATION_BUCKETS convention:
 * an in-enum value increments its own bounded counter; an out-of-enum
 * value is rejected without bumping any nudge counter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
  requireDisplayOrUser: (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
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

describe("T-30a2-i nudge telemetry server closed enum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments nudge_shown_expiry for nudgeShown: 'expiry'", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { nudgeShown: "expiry" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).toHaveBeenCalledWith("nudge_shown_expiry");
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_restock");
  });

  it("increments nudge_shown_restock for nudgeShown: 'restock'", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { nudgeShown: "restock" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).toHaveBeenCalledWith("nudge_shown_restock");
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_expiry");
  });

  it("rejects an out-of-enum nudgeShown value without bumping any nudge counter", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { nudgeShown: "bogus" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_expiry");
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_restock");
    expect(incrementMetric).toHaveBeenCalledWith("telemetry_payload_rejected_enum_mismatch");
  });

  it("does nothing when nudgeShown is absent", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: {}, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_expiry");
    expect(incrementMetric).not.toHaveBeenCalledWith("nudge_shown_restock");
    expect(incrementMetric).not.toHaveBeenCalledWith("telemetry_payload_rejected_enum_mismatch");
  });
});
