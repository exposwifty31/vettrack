import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T6 (distribution program, Android phase): the release build must be signable
// with the owner's upload keystore WITHOUT the secret ever entering the repo.
// Contract: android/keystore.properties (gitignored) feeds signingConfigs.release;
// when the file is absent the build still succeeds unsigned (CI/dev safe).

const repoRoot = resolve(__dirname, "..");
const gradle = readFileSync(resolve(repoRoot, "android/app/build.gradle"), "utf8");
const androidIgnore = readFileSync(resolve(repoRoot, "android/.gitignore"), "utf8");
const rootIgnore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");

describe("android release signing wiring (T6)", () => {
  it("loads keystore.properties with an absent-file fallback guard", () => {
    expect(gradle).toMatch(/rootProject\.file\(["']keystore\.properties["']\)/);
    expect(gradle).toMatch(/hasReleaseSigning\s*=\s*keystorePropertiesFile\.exists\(\)/);
  });

  it("defines signingConfigs.release from the properties file", () => {
    for (const key of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
      expect(gradle).toContain(`keystoreProperties['${key}']`);
    }
  });

  it("applies the release signingConfig only when the properties file exists", () => {
    const releaseBlock = gradle.slice(gradle.indexOf("buildTypes"));
    expect(releaseBlock).toMatch(/if\s*\(hasReleaseSigning\)\s*\{\s*signingConfig\s+signingConfigs\.release/);
  });

  it("keeps keystores and the properties file out of git", () => {
    expect(androidIgnore).toMatch(/^\*\.jks$/m);
    expect(androidIgnore).toMatch(/^\*\.keystore$/m);
    expect(androidIgnore).toMatch(/^keystore\.properties$/m);
    expect(rootIgnore).toMatch(/^android\/keystore\.properties$/m);
  });
});
