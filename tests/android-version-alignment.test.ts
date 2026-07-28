import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// H4 (distribution program Phase 3): the Android shell must ship on the same
// marketing-version line as iOS. versionName mirrors MARKETING_VERSION and
// versionCode follows the monotonic major*10000 + minor*100 + patch scheme, so
// every future marketing bump forces a deliberate Android version decision
// instead of silently shipping "1.0"/1 again.

const repoRoot = resolve(__dirname, "..");

function readGradleVersionFields(): { versionCode: number; versionName: string } {
  const gradle = readFileSync(resolve(repoRoot, "android/app/build.gradle"), "utf8");
  const codeMatch = gradle.match(/versionCode\s+(\d+)/);
  const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
  if (!codeMatch || !nameMatch) {
    throw new Error("android/app/build.gradle is missing versionCode/versionName");
  }
  return { versionCode: Number(codeMatch[1]), versionName: nameMatch[1] };
}

function readIosMarketingVersions(): string[] {
  const pbxproj = readFileSync(
    resolve(repoRoot, "ios/App/App.xcodeproj/project.pbxproj"),
    "utf8",
  );
  const versions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) =>
    m[1].trim(),
  );
  if (versions.length === 0) {
    throw new Error("project.pbxproj has no MARKETING_VERSION entries");
  }
  return versions;
}

function versionCodeFor(versionName: string): number {
  const parts = versionName.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`versionName "${versionName}" is not MAJOR.MINOR.PATCH`);
  }
  const [major, minor, patch] = parts;
  return major * 10000 + minor * 100 + patch;
}

describe("android version alignment (H4)", () => {
  it("keeps every iOS MARKETING_VERSION entry on a single value", () => {
    const versions = new Set(readIosMarketingVersions());
    expect([...versions]).toHaveLength(1);
  });

  it("aligns android versionName with the iOS marketing version", () => {
    const { versionName } = readGradleVersionFields();
    expect(versionName).toBe(readIosMarketingVersions()[0]);
  });

  it("derives android versionCode from versionName via the monotonic scheme", () => {
    const { versionCode, versionName } = readGradleVersionFields();
    expect(versionCode).toBe(versionCodeFor(versionName));
  });
});
