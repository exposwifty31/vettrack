import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, loadConfig, loadConfigFromFile } from "../src/config";

describe("loadConfig", () => {
  it("fills defaults for the aggregation windows and caps", () => {
    const cfg = loadConfig({ apiOrigin: "https://api.test", clinicId: "clinic-a" });
    expect(cfg.debounceMs).toBe(DEFAULT_CONFIG.debounceMs);
    expect(cfg.maxEventsPerBatch).toBe(200);
    expect(cfg.rateLimitPerMinute).toBe(120);
    expect(cfg.bufferCap).toBe(DEFAULT_CONFIG.bufferCap);
  });

  it("rejects an empty apiOrigin or clinicId", () => {
    expect(() => loadConfig({ apiOrigin: "", clinicId: "clinic-a" })).toThrow();
    expect(() => loadConfig({ apiOrigin: "https://api.test", clinicId: "" })).toThrow();
  });

  it("rejects caps that would violate the ingest limits", () => {
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", maxEventsPerBatch: 201 })).toThrow();
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", rateLimitPerMinute: 121 })).toThrow();
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", debounceMs: -1 })).toThrow();
  });

  it("rejects NaN / Infinity / non-integer / non-number numeric fields", () => {
    // NaN and Infinity silently pass every range comparison; reject them up front.
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", debounceMs: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", maxEventsPerBatch: Number.NaN })).toThrow();
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", bufferCap: 1.5 })).toThrow();
    // Untyped JSON from loadConfigFromFile can deliver a numeric string / array.
    // @ts-expect-error — runtime guard for the untyped file-config path
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", rateLimitPerMinute: "50" })).toThrow();
    // @ts-expect-error — runtime guard for the untyped file-config path
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", debounceMs: [1] })).toThrow();
  });

  it("rejects non-string apiOrigin / clinicId / controllerVersion from untyped file config", () => {
    // A numeric / array apiOrigin or clinicId would otherwise throw a bare
    // `.trim()` TypeError with no context about which field was malformed.
    // @ts-expect-error — runtime guard for the untyped file-config path
    expect(() => loadConfig({ apiOrigin: 123, clinicId: "c" })).toThrow("config: apiOrigin must be a string");
    // @ts-expect-error — runtime guard for the untyped file-config path
    expect(() => loadConfig({ apiOrigin: "x", clinicId: ["c"] })).toThrow("config: clinicId must be a string");
    // A non-string controllerVersion would otherwise reach the wire contract.
    // @ts-expect-error — runtime guard for the untyped file-config path
    expect(() => loadConfig({ apiOrigin: "x", clinicId: "c", controllerVersion: 7 })).toThrow(
      "config: controllerVersion must be a string",
    );
  });

  it("does NOT carry a secret (secrets come from env/secret-source only)", () => {
    const cfg = loadConfig({
      apiOrigin: "https://api.test",
      clinicId: "clinic-a",
      // @ts-expect-error — secret is intentionally not part of ControllerConfig
      secret: "should-be-ignored",
    });
    expect(cfg).not.toHaveProperty("secret");
    expect(JSON.stringify(cfg)).not.toContain("should-be-ignored");
  });
});

describe("loadConfigFromFile", () => {
  it("reads a JSON config file and merges defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "rfid-cfg-"));
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ apiOrigin: "https://api.test", clinicId: "clinic-b", debounceMs: 500 }));
    const cfg = loadConfigFromFile(file);
    expect(cfg.clinicId).toBe("clinic-b");
    expect(cfg.debounceMs).toBe(500);
    expect(cfg.maxEventsPerBatch).toBe(200);
  });
});
