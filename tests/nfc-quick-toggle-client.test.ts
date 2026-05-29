import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeNdefTextFromRecord,
  ndefRecordToUint8Array,
} from "../src/lib/nfc-equipment-toggle";

describe("NFC quick toggle client", () => {
  const api = readFileSync(join(process.cwd(), "src/lib/api/equipment.ts"), "utf8");
  const nfcLib = readFileSync(join(process.cwd(), "src/lib/nfc-equipment-toggle.ts"), "utf8");

  it("routes quickToggle through checkout/return (not legacy POST /scan)", () => {
    const quickToggleBlock = api.match(/quickToggle: async[\s\S]*?\n    },/)?.[0] ?? "";
    expect(quickToggleBlock).toContain("/api/equipment/${equipmentId}/checkout");
    expect(quickToggleBlock).toContain("/api/equipment/${equipmentId}/return");
    expect(quickToggleBlock).not.toContain('"/api/equipment/scan"');
    expect(quickToggleBlock.includes("addPendingSync")).toBe(false);
  });

  it("decodes text NDEF from DataView via buffer offset/length", () => {
    expect(nfcLib).toContain("ArrayBuffer.isView(data)");
    expect(nfcLib).toContain("data.byteOffset");
    expect(nfcLib).toContain("data.byteLength");
    expect(nfcLib).toContain("decodeNdefTextFromRecord");
  });

  it("decodes text record payload from a DataView slice", () => {
    const buf = new ArrayBuffer(10);
    const view = new DataView(buf);
    view.setUint8(0, 0x02);
    view.setUint8(1, 0x65);
    view.setUint8(2, 0x6e);
    const payload = "dock-1";
    for (let i = 0; i < payload.length; i++) {
      view.setUint8(3 + i, payload.charCodeAt(i));
    }
    const bytes = ndefRecordToUint8Array(view);
    expect(bytes?.length).toBe(10);
    expect(decodeNdefTextFromRecord({ recordType: "text", data: view })).toBe("dock-1");
  });
});
