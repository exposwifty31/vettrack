/**
 * procedureBoundReleaseWorker — unit regression tests (V2 ops).
 *
 * Verifies feature-flag short-circuit without DB (release sweep is integration-tested).
 */

import { describe, it, expect, afterEach } from "vitest";

const ENV_KEY = "DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1";

describe("runProcedureBoundReleaseSweep feature gate", () => {
  const previous = process.env[ENV_KEY];

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  });

  it("returns zero counts when operational state V1 is disabled", async () => {
    process.env[ENV_KEY] = "true";
    const { runProcedureBoundReleaseSweep } = await import(
      "../server/workers/procedureBoundReleaseWorker.js"
    );
    const result = await runProcedureBoundReleaseSweep(new Date("2026-05-24T12:00:00.000Z"));
    expect(result).toEqual({ scanned: 0, released: 0 });
  });
});

describe("isOperationalStateFeatureEnabled", () => {
  const previous = process.env[ENV_KEY];

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  });

  it("treats common truthy disable strings as off", async () => {
    const { isOperationalStateFeatureEnabled } = await import(
      "../server/services/equipment-operational-state.service.js"
    );
    for (const val of ["1", "true", "TRUE", " yes ", "on"]) {
      process.env[ENV_KEY] = val;
      expect(isOperationalStateFeatureEnabled()).toBe(false);
    }
  });

  it("defaults to enabled when env is unset", async () => {
    delete process.env[ENV_KEY];
    const { isOperationalStateFeatureEnabled } = await import(
      "../server/services/equipment-operational-state.service.js"
    );
    expect(isOperationalStateFeatureEnabled()).toBe(true);
  });
});
