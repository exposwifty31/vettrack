/**
 * @vitest-environment happy-dom
 *
 * R-BDF-1.3 — bounded-enum board anomaly telemetry (mandatory in v1). Anomaly
 * types are a CLOSED enum on the client (`classifyBoardAnomalyType` mirrors the
 * shared `BoardAnomalyType`) AND on the server (`ALLOWED_BOARD_ANOMALY_TYPES` in
 * server/routes/realtime.ts). Each in-enum type maps 1:1 to a fixed metric id
 * (`battery_critical`→`board_anomaly_battery_critical`,
 *  `rfid_reader_offline`→`board_anomaly_reader_offline`,
 *  `cart_unverified`→`board_anomaly_cart_unverified`) routed through
 * `incrementMetric()`. Emission is single-shot, hung on R-BDF-1.2's
 * `absent→active` state-machine seam (NOT once per snapshot): a repeated snapshot
 * emits nothing; a clear-then-reappear re-emits once. Out-of-enum types are
 * rejected UNCONDITIONALLY on both client (never posted) and server (bumps the
 * shared enum-mismatch counter, never a board counter).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { NextFunction, Request, Response } from "express";
import type { BoardAnomaly, BoardAnomalyType } from "../shared/equipment-board";

const { telemetry } = vi.hoisted(() => ({
  telemetry: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/lib/api", () => ({ api: { realtime: { telemetry } } }));

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

import { classifyBoardAnomalyType, reportBoardAnomalyActivated } from "@/lib/realtime";
import { useBoardAnomalyStateMachine } from "@/features/command-board/use-board-anomaly-state-machine";

function anomaly(type: BoardAnomalyType, unitId: string): BoardAnomaly {
  const severity = type === "cart_unverified" ? "calm" : "pressure";
  return {
    type,
    unitId,
    severity,
    since: "2026-07-17T00:00:00.000Z",
    sourceRef: { table: "vt_equipment", id: unitId },
  };
}

describe("R-BDF-1.3 client — closed board-anomaly enum classifier", () => {
  it("classifies each of the three v1 types to itself", () => {
    expect(classifyBoardAnomalyType("battery_critical")).toBe("battery_critical");
    expect(classifyBoardAnomalyType("rfid_reader_offline")).toBe("rfid_reader_offline");
    expect(classifyBoardAnomalyType("cart_unverified")).toBe("cart_unverified");
  });

  it("classifies any out-of-enum type to null (unconditional rejection)", () => {
    expect(classifyBoardAnomalyType("bogus")).toBeNull();
    expect(classifyBoardAnomalyType("")).toBeNull();
    expect(classifyBoardAnomalyType("Battery_Critical")).toBeNull();
    expect(classifyBoardAnomalyType("possible_egress")).toBeNull();
  });
});

describe("R-BDF-1.3 client — reportBoardAnomalyActivated poster", () => {
  beforeEach(() => {
    telemetry.mockClear();
  });

  it("posts boardAnomalyActivated with the exact type for each v1 type", () => {
    reportBoardAnomalyActivated(anomaly("battery_critical", "eq-1"));
    expect(telemetry).toHaveBeenLastCalledWith({ boardAnomalyActivated: "battery_critical" });

    reportBoardAnomalyActivated(anomaly("rfid_reader_offline", "reader-2"));
    expect(telemetry).toHaveBeenLastCalledWith({ boardAnomalyActivated: "rfid_reader_offline" });

    reportBoardAnomalyActivated(anomaly("cart_unverified", "cart-3"));
    expect(telemetry).toHaveBeenLastCalledWith({ boardAnomalyActivated: "cart_unverified" });
  });

  it("never posts for an out-of-enum type (unconditional rejection)", () => {
    reportBoardAnomalyActivated({ type: "bogus" as BoardAnomalyType });
    expect(telemetry).not.toHaveBeenCalled();
  });
});

describe("R-BDF-1.3 client — single-shot emission via the R-BDF-1.2 state-machine seam", () => {
  beforeEach(() => {
    telemetry.mockClear();
  });

  it("emits once on absent→active, nothing on a repeated snapshot, and once again on clear-then-reappear", () => {
    const { rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, reportBoardAnomalyActivated),
      { initialProps: { list: [anomaly("battery_critical", "eq-1")] } },
    );

    // absent → active: single emission with the mapped enum value.
    expect(telemetry).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith({ boardAnomalyActivated: "battery_critical" });

    // Repeated snapshot (fresh array, same (type,unitId)) — emits NOTHING more.
    rerender({ list: [anomaly("battery_critical", "eq-1")] });
    expect(telemetry).toHaveBeenCalledTimes(1);

    // Clear → no emission on clear.
    rerender({ list: [] as BoardAnomaly[] });
    expect(telemetry).toHaveBeenCalledTimes(1);

    // Reappear (cleared → active) — re-emits exactly once.
    rerender({ list: [anomaly("battery_critical", "eq-1")] });
    expect(telemetry).toHaveBeenCalledTimes(2);
  });
});

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

async function loadTelemetryHandler(): Promise<(req: Request, res: Response) => void> {
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
  const layer = stack.stack.find((l) => l.route?.path === "/telemetry" && l.route.methods.post);
  if (!layer?.route) throw new Error("POST /telemetry handler not found");
  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

describe("R-BDF-1.3 server — closed board-anomaly enum → 1:1 metric ids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("battery_critical → board_anomaly_battery_critical (and no other board counter)", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { boardAnomalyActivated: "battery_critical" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).toHaveBeenCalledWith("board_anomaly_battery_critical");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_reader_offline");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_cart_unverified");
  });

  it("rfid_reader_offline → board_anomaly_reader_offline (and no other board counter)", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { boardAnomalyActivated: "rfid_reader_offline" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).toHaveBeenCalledWith("board_anomaly_reader_offline");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_battery_critical");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_cart_unverified");
  });

  it("cart_unverified → board_anomaly_cart_unverified (and no other board counter)", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { boardAnomalyActivated: "cart_unverified" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).toHaveBeenCalledWith("board_anomaly_cart_unverified");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_battery_critical");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_reader_offline");
  });

  it("rejects an out-of-enum type without bumping any board counter (unconditional)", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: { boardAnomalyActivated: "possible_egress" }, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_battery_critical");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_reader_offline");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_cart_unverified");
    expect(incrementMetric).toHaveBeenCalledWith("telemetry_payload_rejected_enum_mismatch");
  });

  it("does nothing when boardAnomalyActivated is absent", async () => {
    const { incrementMetric } = await import("../server/lib/metrics.js");
    const handler = await loadTelemetryHandler();
    const { res, captured } = makeRes();
    handler({ body: {}, headers: {} } as Request, res);
    expect(captured.statusCode).toBe(200);
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_battery_critical");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_reader_offline");
    expect(incrementMetric).not.toHaveBeenCalledWith("board_anomaly_cart_unverified");
    expect(incrementMetric).not.toHaveBeenCalledWith("telemetry_payload_rejected_enum_mismatch");
  });
});
