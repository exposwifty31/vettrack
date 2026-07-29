// Android App Links Digital Asset Links (Phase 3.5) — the Android counterpart to
// the Apple AASA served in server/index.ts. Lets https://vettrack.uk/equipment/*
// deep links (from a QR/NFC sticker scanned outside the app) open the installed
// app after Android verifies this file over HTTPS at install time.

export const ANDROID_PACKAGE = "uk.vettrack.app";

// SHA-256 signing-cert fingerprints Android checks against the installed build.
//
// - The FIRST entry is the UPLOAD key (what our local/testing AAB is signed with) —
//   it lets an upload-signed install verify during the pre-launch audit.
// - Play-delivered installs are re-signed with Google's App Signing key. Its
//   SHA-256 (Play Console → App integrity, exists only AFTER the first AAB upload)
//   MUST be appended here for production App Links to verify. See
//   docs/mobile/play-console-submission-pack.md (§9 post-upload checklist).
export const ANDROID_CERT_FINGERPRINTS: readonly string[] = [
  "93:34:4C:4B:9F:2D:22:CC:61:DA:0C:35:71:CF:98:E5:85:22:A3:0A:CA:B8:98:17:2A:28:E7:FC:9F:82:5C:83",
  // TODO(post-first-upload): "<Play App Signing SHA-256 from App integrity>",
];

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
        sha256_cert_fingerprints: [...ANDROID_CERT_FINGERPRINTS],
      },
    },
  ];
}
