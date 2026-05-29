import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("NFC quick toggle client", () => {
  const api = readFileSync(join(process.cwd(), "src/lib/api/equipment.ts"), "utf8");
  const toggle = readFileSync(join(process.cwd(), "src/lib/nfc-equipment-toggle.ts"), "utf8");

  it("calls POST /api/equipment/scan without offline queue", () => {
    expect(api).toContain('request<QuickScanToggleResult>("/api/equipment/scan"');
    expect(api).toMatch(/quickToggle[\s\S]*\/api\/equipment\/scan/);
    const quickToggleBlock = api.match(/quickToggle: async[\s\S]*?\n    },/)?.[0] ?? "";
    expect(quickToggleBlock.includes("addPendingSync")).toBe(false);
  });

  it("uses sessionStorage idempotency guard", () => {
    expect(toggle).toContain("vt_nfc_toggle_fired:");
    expect(toggle).toContain("NFC_TOGGLE_GUARD_TTL_MS");
  });
});
