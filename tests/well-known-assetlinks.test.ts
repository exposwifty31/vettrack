import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLAY_SIGNING_SHA256_ENV_VAR,
  buildAndroidAssetLinks,
  resolveAndroidCertFingerprints,
} from "../server/lib/well-known-assetlinks";

// The Capacitor shell's local upload keystore (pre-RN, Phase 3.5).
const CAPACITOR_UPLOAD_KEY =
  "93:34:4C:4B:9F:2D:22:CC:61:DA:0C:35:71:CF:98:E5:85:22:A3:0A:CA:B8:98:17:2A:28:E7:FC:9F:82:5C:83";
// The EAS-managed upload keystore that signs the RN AABs before Play re-signs them.
// Measured 2026-09-11: `keytool -printcert -jarfile app-10302.aab` and Play Console →
// App integrity → "Upload key certificate" both read this value.
const EAS_UPLOAD_KEY =
  "38:31:8A:51:1A:61:74:CF:F9:0A:BF:3F:8C:4B:AB:DF:B6:9B:34:F4:82:90:3F:C1:A6:F9:9D:FA:8B:A1:4F:5F";
const PLAY_SIGNING_KEY =
  "C4:17:D1:FA:83:F3:4A:7C:C9:4E:63:14:39:ED:FE:FD:13:F0:B3:2F:D2:BA:D5:65:A8:7C:CC:78:5F:B9:CE:3E";

describe("resolveAndroidCertFingerprints", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[PLAY_SIGNING_SHA256_ENV_VAR];
    delete process.env[PLAY_SIGNING_SHA256_ENV_VAR];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[PLAY_SIGNING_SHA256_ENV_VAR];
    else process.env[PLAY_SIGNING_SHA256_ENV_VAR] = saved;
  });

  it("serves both upload keys with no env var set", () => {
    const fps = resolveAndroidCertFingerprints();
    expect(fps).toContain(CAPACITOR_UPLOAD_KEY);
    expect(fps).toContain(EAS_UPLOAD_KEY);
    expect(fps).not.toContain(PLAY_SIGNING_KEY);
  });

  it("appends the Play App Signing fingerprint from the env var, uppercased", () => {
    process.env[PLAY_SIGNING_SHA256_ENV_VAR] = ` ${PLAY_SIGNING_KEY.toLowerCase()} `;
    const fps = resolveAndroidCertFingerprints();
    expect(fps[fps.length - 1]).toBe(PLAY_SIGNING_KEY);
    expect(fps).toContain(CAPACITOR_UPLOAD_KEY);
    expect(fps).toContain(EAS_UPLOAD_KEY);
  });

  it("drops a malformed env value and never drops an upload key", () => {
    process.env[PLAY_SIGNING_SHA256_ENV_VAR] = "not-a-fingerprint";
    const fps = resolveAndroidCertFingerprints();
    expect(fps).toEqual(expect.arrayContaining([CAPACITOR_UPLOAD_KEY, EAS_UPLOAD_KEY]));
    expect(fps.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))).toBe(true);
  });

  it("buildAndroidAssetLinks carries the same list under the package statement", () => {
    process.env[PLAY_SIGNING_SHA256_ENV_VAR] = PLAY_SIGNING_KEY;
    const [stmt] = buildAndroidAssetLinks();
    expect(stmt.target.package_name).toBe("uk.vettrack.app");
    expect(stmt.target.sha256_cert_fingerprints).toEqual(resolveAndroidCertFingerprints());
  });
});
