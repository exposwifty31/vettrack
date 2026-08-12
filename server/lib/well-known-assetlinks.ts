// Android App Links Digital Asset Links (Phase 3.5) — the Android counterpart to
// the Apple AASA served in server/index.ts. Lets https://vettrack.uk/equipment/*
// deep links (from a QR/NFC sticker scanned outside the app) open the installed
// app after Android verifies this file over HTTPS at install time.

import { ANDROID_APP_PACKAGE } from "../../shared/constants.js";

export const ANDROID_PACKAGE = ANDROID_APP_PACKAGE;

/** Env var carrying the Play App Signing SHA-256 (Play Console → App integrity). */
export const PLAY_SIGNING_SHA256_ENV_VAR = "ANDROID_PLAY_SIGNING_SHA256";

/** Uppercase, colon-separated 32-byte SHA-256 fingerprint (Digital Asset Links format). */
const SHA256_FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// SHA-256 signing-cert fingerprints Android checks against the installed build.
//
// - The UPLOAD key (what our local/testing AAB is signed with) is the constant below —
//   it lets an upload-signed install verify during the pre-launch audit. This covers
//   the Capacitor shell and is intentionally left unchanged.
// - Play-delivered installs are re-signed with Google's App Signing key. Both the
//   Capacitor shell and the Expo/RN app (post identity-migration) ship under the same
//   package `uk.vettrack.app`, i.e. one Play listing with one immutable Play App
//   Signing key — so a single fingerprint covers both. Its SHA-256 (Play Console →
//   App integrity, exists only AFTER the first AAB upload) is owner-gated (O2,
//   EAS-managed signing not yet created), so it is NOT hardcoded here: it is injected
//   at runtime via the ANDROID_PLAY_SIGNING_SHA256 env var and appended additively.
//   Until it is provided we serve the upload-key fingerprint only and log a warning.
//   See docs/mobile/play-console-submission-pack.md (§9 post-upload checklist).
const UPLOAD_KEY_CERT_FINGERPRINT =
  "93:34:4C:4B:9F:2D:22:CC:61:DA:0C:35:71:CF:98:E5:85:22:A3:0A:CA:B8:98:17:2A:28:E7:FC:9F:82:5C:83";

let warnedMissingPlaySigning = false;

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
          `certificate SHA-256). Serving the upload-key fingerprint only.`,
      );
    }
    return undefined;
  }
  const normalized = raw.toUpperCase();
  if (!SHA256_FINGERPRINT_RE.test(normalized)) {
    console.warn(
      `[assetlinks] ${PLAY_SIGNING_SHA256_ENV_VAR} is set but is not a valid ` +
        `colon-separated SHA-256 fingerprint; ignoring it.`,
    );
    return undefined;
  }
  return normalized;
}

// SHA-256 fingerprints served for the Android App Links statement, resolved fresh each
// call: the constant upload key plus the env-sourced Play App Signing key when present
// and well-formed. Additive — the upload-key entry is never dropped.
export function resolveAndroidCertFingerprints(): string[] {
  const playSigning = resolvePlaySigningFingerprint();
  return playSigning ? [UPLOAD_KEY_CERT_FINGERPRINT, playSigning] : [UPLOAD_KEY_CERT_FINGERPRINT];
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
