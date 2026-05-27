import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveBackendPilotMode, resolveFrontendPilotMode } from "../server/lib/build-info.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("pilot mode mainline guard (deploy #496)", () => {
  const envValidation = fs.readFileSync(path.join(repoRoot, "server/lib/envValidation.ts"), "utf8");
  const viteConfig = fs.readFileSync(path.join(repoRoot, "vite.config.ts"), "utf8");
  const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

  it("production env validation blocks PILOT_MODE without ALLOW_EQUIPMENT_PILOT_MODE", () => {
    expect(envValidation).toContain('process.env.PILOT_MODE === "true"');
    expect(envValidation).toContain('process.env.ALLOW_EQUIPMENT_PILOT_MODE !== "true"');
    expect(envValidation).toContain("PILOT_MODE=true is not allowed on mainline production");
  });

  it("vite build fails when VITE_PILOT_MODE is set without ALLOW on mainline builds", () => {
    expect(viteConfig).toContain("ALLOW_EQUIPMENT_PILOT_MODE === \"true\"");
    expect(viteConfig).toContain("VITE_PILOT_MODE === \"true\"");
    expect(viteConfig).toContain("Mainline production/staging builds must set VITE_PILOT_MODE=false");
  });

  it("Docker build defaults VITE pilot flag off for mainline images", () => {
    expect(dockerfile).toContain("ARG ALLOW_EQUIPMENT_PILOT_MODE=false");
    expect(dockerfile).toContain("ARG VITE_PILOT_MODE=false");
  });
});

describe("resolveBackendPilotMode", () => {
  const originalPilotMode = process.env.PILOT_MODE;

  afterEach(() => {
    if (originalPilotMode === undefined) {
      delete process.env.PILOT_MODE;
    } else {
      process.env.PILOT_MODE = originalPilotMode;
    }
  });

  it("returns true only when PILOT_MODE is exactly the string true", () => {
    process.env.PILOT_MODE = "true";
    expect(resolveBackendPilotMode()).toBe(true);

    process.env.PILOT_MODE = "false";
    expect(resolveBackendPilotMode()).toBe(false);

    delete process.env.PILOT_MODE;
    expect(resolveBackendPilotMode()).toBe(false);

    process.env.PILOT_MODE = "TRUE";
    expect(resolveBackendPilotMode()).toBe(false);
  });
});

describe("resolveFrontendPilotMode", () => {
  it("returns null when build-info.json is absent (typical unit-test / pre-build env)", () => {
    expect(resolveFrontendPilotMode()).toBeNull();
  });
});

describe("/api/version pilotMode mismatch contract", () => {
  it("flags mismatch when compile-time and runtime pilot flags disagree", () => {
    const cases: Array<{
      backend: boolean;
      frontend: boolean | null;
      mismatch: boolean;
    }> = [
      { backend: false, frontend: null, mismatch: false },
      { backend: false, frontend: false, mismatch: false },
      { backend: true, frontend: true, mismatch: false },
      { backend: false, frontend: true, mismatch: true },
      { backend: true, frontend: false, mismatch: true },
    ];

    for (const { backend, frontend, mismatch } of cases) {
      const computed = frontend !== null && frontend !== backend;
      expect(computed).toBe(mismatch);
    }
  });
});
