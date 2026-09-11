// Android App Links Digital Asset Links (Phase 3.5) — the Android counterpart to
// the Apple AASA served in server/index.ts. Lets https://vettrack.uk/equipment/*
// deep links (from a QR/NFC sticker scanned outside the app) open the installed
// app after Android verifies this file over HTTPS at install time.

import { ANDROID_APP_PACKAGE } from "../../shared/constants.js";

export const ANDROID_PACKAGE = ANDROID_APP_PACKAGE;

// Env-injected because the Play App Signing certificate exists only AFTER the first
// AAB upload (Play Console → App integrity) — there is nothing to hardcode at build time.
export const PLAY_SIGNING_SHA256_ENV_VAR = "ANDROID_PLAY_SIGNING_SHA256";

// Digital Asset Links matches only this exact form (uppercase, colon-separated), so any
// other shape in the env var must be rejected rather than served to Android verifiers.
const SHA256_FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// SHA-256 signing-cert fingerprints Android checks against the installed build.
//
// - The UPLOAD keys are what OUR artifacts are signed with before Play re-signs them,
//   so an upload-signed install (a local build, an internal-sharing link, the
//   pre-launch audit) verifies. Two lanes ship under the same package, each with
//   its own upload keystore:
//     1. the Capacitor shell's local keystore (Phase 3.5, unchanged);
//     2. the EAS-managed keystore that signs the RN AABs. Measured 2026-09-11:
//        `keytool -printcert -jarfile app-10302.aab` and Play Console → App integrity →
//        "Upload key certificate" both read 38:31:8A:51:…:4F:5F.
// - Play-delivered installs are re-signed with Google's App Signing key. Both lanes
//   ship under `uk.vettrack.app`, i.e. one Play listing with one immutable Play App
//   Signing key — so a single fingerprint covers both. Its SHA-256 (Play Console →
//   App integrity, exists only AFTER the first AAB upload) is injected at runtime via
//   the ANDROID_PLAY_SIGNING_SHA256 env var and appended additively (set on Railway
//   2026-09-10). Until it is provided we serve the upload keys only and log a warning.
//   Owner workflow: docs/runbooks/o2-eas-keystore.md — retrieve the SHA-256 from Play
//   Console, set the env var on Railway, redeploy, then validate
//   https://vettrack.uk/.well-known/assetlinks.json serves every fingerprint.
const UPLOAD_KEY_CERT_FINGERPRINTS = [
  // Capacitor shell — local upload keystore
  "93:34:4C:4B:9F:2D:22:CC:61:DA:0C:35:71:CF:98:E5:85:22:A3:0A:CA:B8:98:17:2A:28:E7:FC:9F:82:5C:83",
  // Expo/RN lane — EAS-managed upload keystore
  "38:31:8A:51:1A:61:74:CF:F9:0A:BF:3F:8C:4B:AB:DF:B6:9B:34:F4:82:90:3F:C1:A6:F9:9D:FA:8B:A1:4F:5F",
];

let warnedMissingPlaySigning = false;
let warnedInvalidPlaySigning = false;

// Resolves the additive Play App Signing fingerprint from the environment. Read at
// request time (not module load) so it is independent of env-bootstrap import order
// and so tests importing this module directly observe the same behavior.
function resolvePlaySigningFingerprint(): string | undefined {
  const raw = process.env[PLAY_SIGNING_SHA256_ENV_VAR]?.trim();
  if (!raw) {
    if (!warnedMissingPlaySigning) {
      warnedMissingPlaySigning = true;
      console.warn(
        `[assetlinks] ${PLAY_SIGNING_SHA256_ENV_VAR} is not set — Play-delivered ` +
          `(App Signing) installs of ${ANDROID_PACKAGE} will NOT verify Android App ` +
          `Links until it is provided (Play Console → App integrity → App signing key ` +
          `certificate SHA-256). Serving the upload-key fingerprints only.`,
      );
    }
    return undefined;
  }
  const normalized = raw.toUpperCase();
  if (!SHA256_FINGERPRINT_RE.test(normalized)) {
    // Warn once, not per request — this route is public and an invalid deploy-time
    // value would otherwise flood the logs under normal traffic.
    if (!warnedInvalidPlaySigning) {
      warnedInvalidPlaySigning = true;
      console.warn(
        `[assetlinks] ${PLAY_SIGNING_SHA256_ENV_VAR} is set but is not a valid ` +
          `colon-separated SHA-256 fingerprint; ignoring it.`,
      );
    }
    return undefined;
  }
  return normalized;
}

// SHA-256 fingerprints served for the Android App Links statement, resolved fresh each
// call: the constant upload keys plus the env-sourced Play App Signing key when present
// and well-formed. Additive — no upload-key entry is ever dropped.
export function resolveAndroidCertFingerprints(): string[] {
  const playSigning = resolvePlaySigningFingerprint();
  return playSigning ? [...UPLOAD_KEY_CERT_FINGERPRINTS, playSigning] : [...UPLOAD_KEY_CERT_FINGERPRINTS];
}

export interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

export function buildAndroidAssetLinks(): AssetLinkStatement[] {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: resolveAndroidCertFingerprints(),
      },
    },
  ];
}
