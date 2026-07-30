/**
 * @vitest-environment happy-dom
 *
 * NFC sticker MANAGEMENT audit — the lifecycle half of Phase 3.5.
 *
 * `tests/nfc-qr-sticker-chain.test.ts` (PR #161) audits the FIELDING chain: a sticker
 * that already exists resolves to the app. This file audits the other half — whether
 * VetTrack itself can run the sticker lifecycle (encode → bind → verify → replace)
 * with no third-party encoder app, and whether what it writes matches the payload
 * spec in `docs/design/nfc-sticker-e2e-audit.md:44-48`.
 *
 * Row ids (M1…M11) match the matrix in `docs/design/nfc-sticker-management-audit.md`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { generateQrUrl } from "@/lib/utils";
import { extractEquipmentId, UNIVERSAL_LINK_ORIGIN } from "@/lib/equipment-id";
import {
  buildEquipmentStickerRecords,
  buildEquipmentStickerUrl,
} from "@/lib/nfc-sticker-payload";
import { decodeCapgoNdefRecords, encodeCapgoNdefAarRecord } from "@/lib/nfc-capgo-decode";
import { ANDROID_APP_PACKAGE } from "../shared/constants";
import { ANDROID_PACKAGE } from "../server/lib/well-known-assetlinks";
import { isUniqueViolation } from "../server/lib/pg-errors";

const repoFile = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");
const bytesToString = (bytes: number[]) => new TextDecoder().decode(new Uint8Array(bytes));

/** Native-shell stand-in: the write path only exists inside Capacitor. */
const nfcMock = vi.hoisted(() => ({ write: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => true,
  capacitorPlatform: () => "ios",
}));

vi.mock("@capgo/capacitor-nfc", () => ({
  CapacitorNfc: {
    startScanning: vi.fn().mockResolvedValue(undefined),
    stopScanning: vi.fn().mockResolvedValue(undefined),
    write: nfcMock.write,
    isSupported: vi.fn().mockResolvedValue({ supported: true }),
    addListener: vi.fn(async (_event: string, cb: (event: unknown) => void) => {
      queueMicrotask(() => cb({ tag: { id: [0x04, 0x1a, 0xff, 0x0b] } }));
      return { remove: vi.fn().mockResolvedValue(undefined) };
    }),
  },
}));

describe("M1 — the write action is admin-gated and hidden without NFC", () => {
  it("gates the sticker writer on admin + device NFC support", () => {
    const src = repoFile("src/pages/equipment-detail.tsx");
    expect(src).toMatch(/showWriteNfc\s*=\s*isAdmin\s*&&\s*nfcWriteSupported/);
    // The handler refuses even if the button somehow renders.
    expect(src).toMatch(/if \(!nfcWriteSupported\)/);
  });
});

describe("M2 — the sticker URL is the same universal link the QR sticker carries", () => {
  it("shares host and path with generateQrUrl (identical resolution)", () => {
    const nfc = new URL(buildEquipmentStickerUrl("eq1"));
    const qr = new URL(generateQrUrl("eq1"));
    expect(nfc.host).toBe(qr.host);
    expect(nfc.pathname).toBe(qr.pathname);
    expect(nfc.origin).toBe(UNIVERSAL_LINK_ORIGIN);
  });

  it("carries the nfcAction=toggle contract and nothing else", () => {
    const url = new URL(buildEquipmentStickerUrl("eq1"));
    expect(url.searchParams.get("nfcAction")).toBe("toggle");
    expect([...url.searchParams.keys()]).toEqual(["nfcAction"]);
  });
});

describe("M3 — the NDEF payload matches the spec: URI record + AAR record", () => {
  it("writes exactly two records", () => {
    expect(buildEquipmentStickerRecords("eq1")).toHaveLength(2);
  });

  it("record 1 is a well-known URI record with the https:// prefix byte (0x04)", () => {
    const [uri] = buildEquipmentStickerRecords("eq1");
    expect(uri.tnf).toBe(0x01);
    expect(uri.type).toEqual([0x55]);
    expect(uri.payload?.[0]).toBe(0x04);
    expect(bytesToString(uri.payload!.slice(1))).toBe("vettrack.uk/equipment/eq1?nfcAction=toggle");
  });

  it("record 2 is the Android Application Record for the app package", () => {
    const [, aar] = buildEquipmentStickerRecords("eq1");
    expect(aar.tnf).toBe(0x04);
    expect(bytesToString(aar.type!)).toBe("android.com:pkg");
    expect(bytesToString(aar.payload!)).toBe("uk.vettrack.app");
  });

  it("the package name has a single source of truth shared with assetlinks.json", () => {
    expect(ANDROID_APP_PACKAGE).toBe(ANDROID_PACKAGE);
    expect(bytesToString(encodeCapgoNdefAarRecord(ANDROID_APP_PACKAGE).payload!)).toBe(
      ANDROID_APP_PACKAGE,
    );
  });

  it("stays far inside the NTAG215 504-byte budget", () => {
    const total = buildEquipmentStickerRecords("550e8400-e29b-41d4-a716-446655440000").reduce(
      (sum, r) => sum + (r.type?.length ?? 0) + (r.id?.length ?? 0) + (r.payload?.length ?? 0),
      0,
    );
    expect(total).toBeLessThan(200);
  });
});

describe("M8 — a written sticker reads back to the same equipment", () => {
  it("round-trips through the decoder the in-app scanner uses", () => {
    for (const id of ["eq1", "550e8400-e29b-41d4-a716-446655440000"]) {
      const { url } = decodeCapgoNdefRecords(buildEquipmentStickerRecords(id), null);
      expect(url).toBe(buildEquipmentStickerUrl(id));
      expect(extractEquipmentId(url!)).toBe(id);
    }
  });

  it("the AAR record does not confuse the URL decoder", () => {
    const { text } = decodeCapgoNdefRecords(buildEquipmentStickerRecords("eq1"), null);
    expect(text).toBeNull();
  });
});

describe("M4 — the write captures the physical tag UID so it can be bound", () => {
  beforeEach(() => {
    nfcMock.write.mockClear();
  });

  it("resolves with the tag UID as hex instead of discarding it", async () => {
    const { writeEquipmentStickerTag } = await import("@/lib/nfc-platform");
    await expect(writeEquipmentStickerTag("eq1")).resolves.toBe("041aff0b");
  });

  it("writes both spec records to the tag", async () => {
    const { writeEquipmentStickerTag } = await import("@/lib/nfc-platform");
    await writeEquipmentStickerTag("eq1");
    const [options] = nfcMock.write.mock.calls.at(-1) as [{ records: unknown[] }];
    expect(options.records).toHaveLength(2);
  });
});

describe("M5 — binding a tag already bound elsewhere is a clean conflict, not a 500", () => {
  it("classifies the Postgres unique violation for the nfc_tag_id constraint", () => {
    const err = { code: "23505", constraint: "vt_equipment_nfc_tag_id_unique" };
    expect(isUniqueViolation(err, "vt_equipment_nfc_tag_id_unique")).toBe(true);
  });

  it("does not classify unrelated failures", () => {
    expect(isUniqueViolation(new Error("boom"), "vt_equipment_nfc_tag_id_unique")).toBe(false);
    expect(isUniqueViolation({ code: "23503" }, "vt_equipment_nfc_tag_id_unique")).toBe(false);
    expect(isUniqueViolation({ code: "23505", constraint: "other_unique" }, "vt_equipment_nfc_tag_id_unique")).toBe(
      false,
    );
  });

  it("the PATCH handler maps it to 409 with a reason that discloses no other tenant's data", () => {
    const src = repoFile("server/routes/equipment/handlers/patch-equipment.ts");
    expect(src).toMatch(/NFC_TAG_ALREADY_BOUND/);
    expect(src).toMatch(/isUniqueViolation/);
    // The message must not name the owning equipment/clinic — the unique index is global.
    const message = src.match(/reason: "NFC_TAG_ALREADY_BOUND",\s*\n\s*message: "([^"]+)"/)?.[1] ?? "";
    expect(message).not.toMatch(/clinic|owner|equipment id/i);
  });
});

describe("M7 — binding a tag lands in the audit log", () => {
  it("PATCH /equipment/:id audits with a member of the closed AuditActionType union", () => {
    const src = repoFile("server/routes/equipment/handlers/patch-equipment.ts");
    expect(src).toMatch(/actionType: "equipment_updated"/);
    expect(src).toMatch(/changes: req\.body/);
    const audit = repoFile("server/lib/audit.ts");
    expect(audit).toMatch(/"equipment_updated"/);
  });
});

describe("M11 — ADR-006 posture: the sticker never becomes custody authority", () => {
  it("the payload builder performs no custody mutation — it is pure encoding", () => {
    const src = repoFile("src/lib/nfc-sticker-payload.ts");
    expect(src).not.toMatch(/from "@\/lib\/api"/);
    expect(src).not.toMatch(/checkout|checkOut/i);
  });

  it("writing a tag does not check equipment out — it only programs and binds", () => {
    const src = repoFile("src/pages/equipment-detail.tsx");
    const handler = src.slice(
      src.indexOf("async function writeEquipmentNfcTag"),
      src.indexOf("const isNfcEntry"),
    );
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).not.toMatch(/checkout|checkOut|\.return\(/);
  });
});
