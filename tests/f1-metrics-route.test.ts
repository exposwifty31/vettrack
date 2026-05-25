/**
 * F1d-1 — GET /api/metrics exposes jobRegistry counters from getMetricsSnapshot().
 *
 * Drives the metrics router directly (no live server), matching
 * tests/clinical-check-in.routes.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics.js";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown }).authUser = {
      id: "admin-user",
      email: "admin@clinic.test",
      clinicId: "clinic-1",
      role: "admin",
    };
    next();
  },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: { role?: string } }).authUser;
    if (user?.role !== "admin") {
      res.status(403).json({
        code: "FORBIDDEN",
        error: "FORBIDDEN",
        reason: "INSUFFICIENT_ROLE",
        message: "Admin role required",
        requestId: "test-req",
      });
      return;
    }
    next();
  },
}));

type Captured = { statusCode: number; body: Record<string, unknown> };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: {} };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(): Request {
  return {
    method: "GET",
    url: "/",
    originalUrl: "/",
    headers: {},
    params: {},
    query: {},
  } as unknown as Request;
}

async function getMetricsViaRoute(): Promise<Captured> {
  const { default: router } = await import("../server/routes/metrics.js");
  const { res, captured } = makeRes();
  const req = makeReq();

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    res.json = (payload: unknown) => {
      captured.body = payload as Record<string, unknown>;
      const ret = origJson(payload);
      setImmediate(finish);
      return ret;
    };
    router(req, res, () => finish());
    setTimeout(finish, 200);
  });

  return captured;
}

describe("GET /api/metrics — jobRegistry (F1d-1)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("includes jobRegistry with all F1b/F2c counters at zero by default", async () => {
    const { statusCode, body } = await getMetricsViaRoute();

    expect(statusCode).toBe(200);
    expect(body.jobRegistry).toEqual({
      replayIdempotencyCollision: 0,
      jobRuntimeUnknownJobName: 0,
      legacyWorkerStarterUsed: 0,
      jobRuntimeWorkerUnavailable: 0,
      jobEnqueueQueueUnavailable: 0,
    });
  });

  it("reflects incremented jobRegistry counters from runtime metrics", async () => {
    incrementMetric("replay_idempotency_collision");
    incrementMetric("job_runtime_unknown_job_name");
    incrementMetric("legacy_worker_starter_used");
    incrementMetric("job_runtime_worker_unavailable");
    incrementMetric("job_enqueue_queue_unavailable");

    const { statusCode, body } = await getMetricsViaRoute();

    expect(statusCode).toBe(200);
    expect(body.jobRegistry).toEqual({
      replayIdempotencyCollision: 1,
      jobRuntimeUnknownJobName: 1,
      legacyWorkerStarterUsed: 1,
      jobRuntimeWorkerUnavailable: 1,
      jobEnqueueQueueUnavailable: 1,
    });
    expect(body.jobRegistry).toEqual(getMetricsSnapshot().jobRegistry);
  });

  it("does not expose snake_case metric names as dynamic jobRegistry keys", async () => {
    const { body } = await getMetricsViaRoute();
    const registry = body.jobRegistry as Record<string, unknown>;

    expect(registry).not.toHaveProperty("replay_idempotency_collision");
    expect(registry).not.toHaveProperty("job_runtime_unknown_job_name");
    expect(registry).not.toHaveProperty("legacy_worker_starter_used");
    expect(registry).not.toHaveProperty("job_runtime_worker_unavailable");
    expect(registry).not.toHaveProperty("job_enqueue_queue_unavailable");
  });
});
