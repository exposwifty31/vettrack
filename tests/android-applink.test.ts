import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 3.5: Android App Links for https://vettrack.uk/equipment/* — so a QR/NFC
// sticker tapped/scanned outside the app opens the app (verified against
// /.well-known/assetlinks.json). Separate from the vettrack:// OAuth filter (T4)
// and from MAIN/LAUNCHER. Scoped to /equipment/ so other vettrack.uk links keep
// opening in the browser.

const manifest = readFileSync(
  resolve(__dirname, "..", "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const filters = [...manifest.matchAll(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g)].map(
  (m) => m[0],
);

describe("Android App Links for /equipment/* (Phase 3.5)", () => {
  const appLink = filters.find(
    (f) => f.includes('android:scheme="https"') && f.includes('android:host="vettrack.uk"'),
  );

  it("declares an autoVerify https VIEW filter for vettrack.uk", () => {
    expect(appLink, "no https App Link filter for vettrack.uk").toBeTruthy();
    expect(appLink).toContain("android.intent.action.VIEW");
    expect(appLink).toContain("android.intent.category.DEFAULT");
    expect(appLink).toContain("android.intent.category.BROWSABLE");
    expect(appLink).toMatch(/android:autoVerify="true"/);
  });

  it("is scoped to the /equipment/ path (does not hijack all of vettrack.uk)", () => {
    expect(appLink).toContain('android:pathPrefix="/equipment/"');
  });

  it("does not disturb the MAIN/LAUNCHER or vettrack:// OAuth filters", () => {
    const launcher = filters.find((f) => f.includes("android.intent.category.LAUNCHER"));
    expect(launcher).toBeTruthy();
    expect(launcher).not.toContain('android:scheme="https"');
    const oauth = filters.find((f) => f.includes('android:scheme="vettrack"'));
    expect(oauth, "T4 vettrack:// filter must still exist").toBeTruthy();
  });
});
