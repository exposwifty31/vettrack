// Phase 9 — Display-device pairing: token primitives + pairing-code lifecycle.
//
// Pure unit tests (no DB, no Redis — the pairing store falls back to its bounded
// in-process Map). Covers:
//   - device token format + deterministic hashing + constant-time compare
//   - pairing code issue → claim happy path
//   - single-use (a code is redeemable at most once)
//   - TTL expiry
//   - unknown / malformed codes rejected
//   - structural route-guard assertions: the display token reaches ONLY
//     snapshot/heartbeat/stream; /pair/claim is rate-limited; admin surfaces
//     stay requireAuth+requireAdmin.

import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_TOKEN_PREFIX,
  PAIRING_CODE_TTL_MS,
  _resetPairingCodeStoreForTests,
  constantTimeEqual,
  consumePairingCode,
  hashToken,
  issuePairingCode,
  looksLikeDisplayToken,
  mintToken,
  normalizePairingCode,
} from "../server/lib/display-token";

describe("display device token primitives", () => {
  it("mintToken has the vtd_ prefix and high entropy", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.startsWith(DISPLAY_TOKEN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    // 32 bytes base64url ≈ 43 chars after the prefix.
    expect(a.length).toBeGreaterThan(DISPLAY_TOKEN_PREFIX.length + 40);
  });

  it("looksLikeDisplayToken only matches the vtd_ shape", () => {
    expect(looksLikeDisplayToken(mintToken())).toBe(true);
    expect(looksLikeDisplayToken("vtd_")).toBe(false);
    expect(looksLikeDisplayToken("eyJhbGciOi.jwt.token")).toBe(false);
  });

  it("hashToken is a deterministic 64-char sha256 hex, distinct per token", () => {
    const token = mintToken();
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(mintToken())).not.toBe(h1);
  });

  it("constantTimeEqual matches only identical strings", () => {
    const h = hashToken(mintToken());
    expect(constantTimeEqual(h, h)).toBe(true);
    expect(constantTimeEqual(h, "0".repeat(64))).toBe(false);
    expect(constantTimeEqual(h, h.slice(0, 63))).toBe(false); // length mismatch
  });
});

describe("pairing code normalization", () => {
  it("uppercases and strips dashes/spaces to the 8-char code", () => {
    expect(normalizePairingCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizePairingCode("  a b c d 2 3 4 5 ")).toBe("ABCD2345");
  });
  it("rejects wrong-length or non-string input", () => {
    expect(normalizePairingCode("ABC")).toBeNull();
    expect(normalizePairingCode("ABCDEFGHIJ")).toBeNull();
    expect(normalizePairingCode(123 as unknown)).toBeNull();
    expect(normalizePairingCode(null)).toBeNull();
  });
});

describe("pairing code lifecycle (in-process fallback)", () => {
  beforeEach(() => {
    _resetPairingCodeStoreForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetPairingCodeStoreForTests();
  });

  it("issue → claim returns the bound clinicId", async () => {
    const issued = await issuePairingCode("clinic-A");
    expect(issued.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const clinicId = await consumePairingCode(issued.code);
    expect(clinicId).toBe("clinic-A");
  });

  it("is single-use — a second claim returns null", async () => {
    const issued = await issuePairingCode("clinic-A");
    expect(await consumePairingCode(issued.code)).toBe("clinic-A");
    expect(await consumePairingCode(issued.code)).toBeNull();
  });

  it("tolerates dashed/lowercased user input on claim", async () => {
    const issued = await issuePairingCode("clinic-A");
    const messy = `${issued.code.slice(0, 4).toLowerCase()}-${issued.code.slice(4).toLowerCase()}`;
    expect(await consumePairingCode(messy)).toBe("clinic-A");
  });

  it("expires after the TTL", async () => {
    vi.useFakeTimers();
    const issued = await issuePairingCode("clinic-A");
    vi.advanceTimersByTime(PAIRING_CODE_TTL_MS + 1000);
    expect(await consumePairingCode(issued.code)).toBeNull();
  });

  it("rejects an unknown but well-formed code", async () => {
    expect(await consumePairingCode("ABCD2345")).toBeNull();
  });

  it("rejects a malformed code", async () => {
    expect(await consumePairingCode("nope")).toBeNull();
  });

  it("keeps codes clinic-bound (no cross-clinic leakage)", async () => {
    const a = await issuePairingCode("clinic-A");
    const b = await issuePairingCode("clinic-B");
    expect(await consumePairingCode(b.code)).toBe("clinic-B");
    expect(await consumePairingCode(a.code)).toBe("clinic-A");
  });
});

describe("route guards — display token reaches ONLY snapshot/heartbeat/stream", () => {
  const displaySrc = readFileSync("./server/routes/display.ts", "utf-8");
  const realtimeSrc = readFileSync("./server/routes/realtime.ts", "utf-8");

  it("/snapshot + /heartbeat use requireDisplayOrUser", () => {
    expect(displaySrc).toMatch(/router\.get\(\s*["']\/snapshot["']\s*,\s*requireDisplayOrUser/);
    expect(displaySrc).toMatch(/router\.post\(\s*["']\/heartbeat["']\s*,\s*requireDisplayOrUser/);
  });

  it("/stream uses requireDisplayOrUser (frozen SSE body otherwise untouched)", () => {
    expect(realtimeSrc).toMatch(/router\.get\(\s*["']\/stream["']\s*,\s*requireDisplayOrUser/);
  });

  it("/pair/claim is PUBLIC but rate-limited by authSensitiveLimiter", () => {
    expect(displaySrc).toMatch(/router\.post\(\s*["']\/pair\/claim["']\s*,\s*authSensitiveLimiter/);
  });

  it("/pair/issue and /devices* stay requireAuth + requireAdmin (never accept a display token)", () => {
    expect(displaySrc).toMatch(/router\.post\(\s*["']\/pair\/issue["']\s*,\s*requireAuth\s*,\s*requireAdmin/);
    expect(displaySrc).toMatch(/router\.get\(\s*["']\/devices["']\s*,\s*requireAuth\s*,\s*requireAdmin/);
    expect(displaySrc).toMatch(/router\.patch\(\s*["']\/devices\/:id["']\s*,\s*requireAuth\s*,\s*requireAdmin/);
    expect(displaySrc).toMatch(/router\.post\(\s*["']\/devices\/:id\/revoke["']\s*,\s*requireAuth\s*,\s*requireAdmin/);
    expect(displaySrc).toMatch(/router\.delete\(\s*["']\/devices\/:id["']\s*,\s*requireAuth\s*,\s*requireAdmin/);
  });

  it("never selects or returns the token hash from /devices", () => {
    // The devices list/rename projections must not include tokenHash.
    const devicesBlock = displaySrc.slice(displaySrc.indexOf("createDevicesListHandler"));
    expect(devicesBlock).not.toMatch(/tokenHash:\s*displayDevices\.tokenHash/);
  });
});

describe("DELETE /devices/:id — dead-row removal (T21 item 3)", () => {
  const displaySrc = readFileSync("./server/routes/display.ts", "utf-8");
  const deleteBlock = displaySrc.slice(
    displaySrc.indexOf("function createDeviceDeleteHandler"),
    displaySrc.indexOf("/** Factory"),
  );

  it("scopes the delete by clinicId (multi-tenancy invariant)", () => {
    expect(deleteBlock).toMatch(/eq\(displayDevices\.clinicId,\s*clinicId\)/);
  });

  it("only deletes an already-revoked (dead) row, never an active one", () => {
    expect(deleteBlock).toMatch(/isNotNull\(displayDevices\.revokedAt\)/);
  });

  it("hard-deletes the device row but only logs an audit entry — never deletes from vt_audit_logs", () => {
    expect(deleteBlock).toMatch(/db\s*\.delete\(displayDevices\)/);
    expect(deleteBlock).toMatch(/actionType:\s*["']display_device_deleted["']/);
    expect(deleteBlock).not.toMatch(/\.delete\(auditLogs\)/);
  });

  it("404s (not a silent success) when the device is missing, still active, or in another clinic", () => {
    expect(deleteBlock).toMatch(/if \(!deleted\)/);
    expect(deleteBlock).toMatch(/status\(404\)/);
  });
});
