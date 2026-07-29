/**
 * @vitest-environment happy-dom
 *
 * Phase 3.5 — the physical sticker chain must resolve to the app end-to-end, and
 * the QR chain must behave IDENTICALLY to the NFC chain. Both a QR sticker and an
 * NFC sticker for the same equipment must encode the SAME production universal
 * link (https://vettrack.uk/equipment/<id>) so that:
 *   - scanned by the phone's native camera → App Links / Universal Links fire → app opens
 *   - scanned in-app → extractEquipmentId decodes the id (host-agnostic)
 *
 * Bug this locks out: generateQrUrl used window.location.origin, so a QR printed
 * from the native app (capacitor://localhost) or a preview host encoded a
 * non-universal-link URL — the native camera would open nothing / a dead browser
 * tab. The NFC writer already learned this (uses UNIVERSAL_LINK_ORIGIN); QR now matches.
 */
import { describe, it, expect } from "vitest";
import { generateQrUrl } from "@/lib/utils";
import { extractEquipmentId, UNIVERSAL_LINK_ORIGIN, UNIVERSAL_LINK_HOST } from "@/lib/equipment-id";
import { buildAndroidAssetLinks, ANDROID_PACKAGE } from "@/../server/lib/well-known-assetlinks";

describe("QR sticker chain (Phase 3.5)", () => {
  it("generateQrUrl encodes the production universal link, independent of window.location.origin", () => {
    // happy-dom sets window.location.origin to something like http://localhost —
    // the QR must NOT use it; it must always be the universal-link origin.
    expect(generateQrUrl("eq1")).toBe(`${UNIVERSAL_LINK_ORIGIN}/equipment/eq1`);
    expect(generateQrUrl("eq1").startsWith(`https://${UNIVERSAL_LINK_HOST}/`)).toBe(true);
    expect(generateQrUrl("eq1")).not.toContain(window.location.host);
  });

  it("round-trips: extractEquipmentId(generateQrUrl(id)) === id", () => {
    for (const id of ["eq1", "abc-123", "550e8400-e29b-41d4-a716-446655440000"]) {
      expect(extractEquipmentId(generateQrUrl(id))).toBe(id);
    }
  });

  it("QR and NFC stickers for the same equipment share the same host (identical resolution)", () => {
    const qr = new URL(generateQrUrl("eq1"));
    const nfc = new URL(`${UNIVERSAL_LINK_ORIGIN}/equipment/eq1?nfcAction=toggle&source=nfc`);
    expect(qr.host).toBe(nfc.host);
    expect(qr.pathname).toBe(nfc.pathname);
  });
});

describe("Android assetlinks.json (Phase 3.5)", () => {
  it("delegates all-URL handling to the app package", () => {
    const links = buildAndroidAssetLinks();
    expect(Array.isArray(links)).toBe(true);
    const stmt = links[0];
    expect(stmt.relation).toContain("delegate_permission/common.handle_all_urls");
    expect(stmt.target.namespace).toBe("android_app");
    expect(stmt.target.package_name).toBe(ANDROID_PACKAGE);
    expect(ANDROID_PACKAGE).toBe("uk.vettrack.app");
  });

  it("carries at least one uppercase colon-separated SHA-256 fingerprint", () => {
    const fps = buildAndroidAssetLinks()[0].target.sha256_cert_fingerprints;
    expect(fps.length).toBeGreaterThanOrEqual(1);
    for (const fp of fps) {
      expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });
});
