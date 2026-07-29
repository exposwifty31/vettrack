import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T4 (distribution program, Android phase): the Clerk OAuth callback redirects
// to vettrack://oauth-callback (src/lib/native-oauth.ts) on EVERY Capacitor
// platform, but only iOS declared the scheme (Info.plist CFBundleURLSchemes).
// Android must register it via a VIEW intent-filter on MainActivity or the
// callback can never reach the app. Kept as a SECOND filter — merging into the
// MAIN/LAUNCHER filter breaks launcher matching.

const manifest = readFileSync(
  resolve(__dirname, "..", "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);

describe("android vettrack:// scheme registration (T4)", () => {
  it("declares a browsable VIEW intent-filter for the vettrack scheme", () => {
    const filters = [...manifest.matchAll(/<intent-filter>[\s\S]*?<\/intent-filter>/g)].map(
      (m) => m[0],
    );
    const schemeFilter = filters.find((f) => f.includes('android:scheme="vettrack"'));
    expect(schemeFilter, "no intent-filter carries the vettrack scheme").toBeTruthy();
    expect(schemeFilter).toContain('android.intent.action.VIEW');
    expect(schemeFilter).toContain('android.intent.category.DEFAULT');
    expect(schemeFilter).toContain('android.intent.category.BROWSABLE');
  });

  it("keeps the scheme filter separate from the MAIN/LAUNCHER filter", () => {
    const launcherFilter = [...manifest.matchAll(/<intent-filter>[\s\S]*?<\/intent-filter>/g)]
      .map((m) => m[0])
      .find((f) => f.includes("android.intent.category.LAUNCHER"));
    expect(launcherFilter).toBeTruthy();
    expect(launcherFilter).not.toContain('android:scheme="vettrack"');
  });

  it("iOS parity: the same scheme stays declared in Info.plist", () => {
    const plist = readFileSync(
      resolve(__dirname, "..", "ios/App/App/Info.plist"),
      "utf8",
    );
    expect(plist).toContain("<string>vettrack</string>");
  });
});
