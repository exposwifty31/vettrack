/**
 * D2 server half — POST /api/equipment/scan must sit behind the replay
 * idempotency middleware. The RN offline queue replays /scan with a stored
 * Idempotency-Key; without this guard a duplicate delivery of a TOGGLE
 * double-flips custody (the unit reads returned while in someone's hands).
 *
 * Two pins, both structural (the tenant-lint/source-contract precedent —
 * tests/restock-scan-item-tenant-scope.test.ts):
 *   1. the registry names the endpoint;
 *   2. the /scan registration line carries the middleware — so removing
 *      either half goes red on its own.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS } from "../server/lib/equipment-replay-idempotency";

const ROUTES_SRC = readFileSync("server/routes/equipment.ts", "utf8");

describe("POST /scan replay idempotency (D2 server half)", () => {
  it("the registry names the quick-scan endpoint", () => {
    expect(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.quickScan).toBe("POST /api/equipment/scan");
  });

  it("the /scan registration carries the replay middleware, after body validation", () => {
    const registration = ROUTES_SRC.match(/router\.post\(\s*"\/scan",[\s\S]{0,700}?async \(req, res\)/)?.[0] ?? "";
    expect(registration.length).toBeGreaterThan(0);
    const validateAt = registration.indexOf("validateBody(quickScanBodySchema)");
    const replayAt = registration.indexOf(
      "equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.quickScan)",
    );
    expect(validateAt).toBeGreaterThan(-1);
    expect(replayAt).toBeGreaterThan(-1);
    // Order matters: the replay hash covers req.body, so a malformed request
    // must be rejected BEFORE it can be recorded as the key's stored outcome.
    expect(validateAt).toBeLessThan(replayAt);
  });
});
