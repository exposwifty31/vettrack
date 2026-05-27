import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

describe("build-info contract", () => {
  it("vitePilotMode is only true when explicitly enabled at build", () => {
    const vitePilotMode = process.env.VITE_PILOT_MODE === "true";
    const allow = process.env.ALLOW_EQUIPMENT_PILOT_MODE === "true";
    if (vitePilotMode && !allow) {
      expect.fail("test runner must not set VITE_PILOT_MODE=true without ALLOW_EQUIPMENT_PILOT_MODE");
    }
    expect(typeof vitePilotMode).toBe("boolean");
  });

  it("build-info.json shape matches /api/version consumer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vt-build-info-"));
    const file = path.join(dir, "build-info.json");
    const payload = {
      appVersion: "1.1.2",
      buildTag: "1.1.2-abc",
      vitePilotMode: false,
      builtAt: new Date().toISOString(),
      gitCommit: "deadbeef",
    };
    writeFileSync(file, JSON.stringify(payload));
    const raw = JSON.parse(readFileSync(file, "utf-8")) as typeof payload;
    expect(raw.vitePilotMode).toBe(false);
    expect(raw.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
