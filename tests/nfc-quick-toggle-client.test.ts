import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeNdefTextFromRecord,
  decodeNdefTextFromReadingEvent,
  decodeNdefUrlFromReadingEvent,
  markNfcToggleFired,
  nfcToggleGuardKey,
  ndefRecordToUint8Array,
  wasNfcToggleFiredRecently,
} from "../src/lib/nfc-equipment-toggle";

describe("NFC quick toggle client", () => {
  const api = readFileSync(join(process.cwd(), "src/lib/api/equipment.ts"), "utf8");
  const nfcLib = readFileSync(join(process.cwd(), "src/lib/nfc-equipment-toggle.ts"), "utf8");

  it("routes quickToggle through POST /toggle only (not GET or legacy /scan)", () => {
    const quickToggleBlock = api.match(/quickToggle: async[\s\S]*?\n    },/)?.[0] ?? "";
    expect(quickToggleBlock).toContain("/api/equipment/${equipmentId}/toggle");
    expect(quickToggleBlock).not.toContain("/api/equipment/${equipmentId}/checkout");
    expect(quickToggleBlock).not.toContain("/api/equipment/${equipmentId}/return");
    expect(quickToggleBlock).not.toMatch(/request<Equipment>\(`\/api\/equipment\/\$\{equipmentId\}`\)/);
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

describe("NDEF decode helpers", () => {
  it("returns null for non-text record types", () => {
    expect(decodeNdefTextFromRecord({ recordType: "url", data: new Uint8Array([1, 2]) })).toBeNull();
  });

  it("decodeNdefTextFromReadingEvent picks first text record", () => {
    const event = {
      message: {
        records: [
          { recordType: "empty", data: undefined },
          { recordType: "text", data: new TextEncoder().encode("\x02enTAG-42") },
        ],
      },
    };
    expect(decodeNdefTextFromReadingEvent(event)).toBe("TAG-42");
  });

  it("decodeNdefUrlFromReadingEvent applies NDEF URL prefix code", () => {
    const body = new TextEncoder().encode("example.com/path");
    const data = new Uint8Array(1 + body.length);
    data[0] = 0x04; // https://
    data.set(body, 1);
    expect(
      decodeNdefUrlFromReadingEvent({
        message: { records: [{ recordType: "url", data }] },
      }),
    ).toBe("https://example.com/path");
  });

  it("decodeNdefUrlFromReadingEvent accepts absolute-url record type", () => {
    const body = new TextEncoder().encode("vettrack.uk/e/1");
    const data = new Uint8Array(1 + body.length);
    data[0] = 0x03; // http://
    data.set(body, 1);
    expect(
      decodeNdefUrlFromReadingEvent({
        message: { records: [{ recordType: "absolute-url", data }] },
      }),
    ).toBe("http://vettrack.uk/e/1");
  });
});

describe("NFC toggle dedupe guard", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nfcToggleGuardKey is stable per equipment id", () => {
    expect(nfcToggleGuardKey("eq-1")).toBe("vt_nfc_toggle_fired:eq-1");
  });

  it("wasNfcToggleFiredRecently is false before mark", () => {
    expect(wasNfcToggleFiredRecently("eq-1")).toBe(false);
  });

  it("wasNfcToggleFiredRecently is true immediately after mark", () => {
    markNfcToggleFired("eq-1");
    expect(wasNfcToggleFiredRecently("eq-1")).toBe(true);
  });
});
