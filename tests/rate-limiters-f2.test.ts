import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_LIMITER_MAX_PER_MINUTE,
  rateLimitUserKey,
  SCAN_LIMITER_MAX_PER_MINUTE,
  shouldSkipPerIpApiThrottles,
  WRITE_LIMITER_MAX_PER_MINUTE,
} from "../server/middleware/rate-limiters.js";

function mockReq(params: {
  authUserId?: string;
  ip?: string;
}): Request {
  return {
    authUser: params.authUserId ? { id: params.authUserId } : undefined,
    ip: params.ip ?? "203.0.113.10",
  } as Request;
}

describe("F2: rate limiter per-user keys", () => {
  it("F2: two authenticated users behind the same IP get distinct buckets", () => {
    const ip = "203.0.113.55";
    const keyA = rateLimitUserKey(mockReq({ authUserId: "user-alpha", ip }));
    const keyB = rateLimitUserKey(mockReq({ authUserId: "user-beta", ip }));
    expect(keyA).toBe("user:user-alpha");
    expect(keyB).toBe("user:user-beta");
    expect(keyA).not.toBe(keyB);
  });

  it("F2: unauthenticated requests fall back to IP-scoped keys", () => {
    const key = rateLimitUserKey(mockReq({ ip: "203.0.113.99" }));
    expect(key.startsWith("ip:")).toBe(true);
  });

  it("F2: scan/write/checkout limiters allow 100+ actions per minute per user (ceiling 600)", () => {
    expect(SCAN_LIMITER_MAX_PER_MINUTE).toBeGreaterThanOrEqual(100);
    expect(CHECKOUT_LIMITER_MAX_PER_MINUTE).toBeGreaterThanOrEqual(100);
    expect(WRITE_LIMITER_MAX_PER_MINUTE).toBeGreaterThanOrEqual(100);
  });

  it("F2: per-IP throttles skip under vitest, TEST_MODE, and Playwright E2E", () => {
    const env = process.env;
    try {
      delete process.env.NODE_ENV;
      delete process.env.TEST_MODE;
      delete process.env.PLAYWRIGHT_E2E;
      expect(shouldSkipPerIpApiThrottles()).toBe(false);

      process.env.NODE_ENV = "test";
      expect(shouldSkipPerIpApiThrottles()).toBe(true);
      delete process.env.NODE_ENV;

      process.env.TEST_MODE = "true";
      expect(shouldSkipPerIpApiThrottles()).toBe(true);
      delete process.env.TEST_MODE;

      process.env.PLAYWRIGHT_E2E = "true";
      expect(shouldSkipPerIpApiThrottles()).toBe(true);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      process.env.TEST_MODE = env.TEST_MODE;
      process.env.PLAYWRIGHT_E2E = env.PLAYWRIGHT_E2E;
    }
  });
});
