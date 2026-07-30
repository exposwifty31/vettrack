/**
 * Guard: a Capacitor plugin written in Swift does NOTHING unless the file is in
 * the App target's Compile Sources phase. `ios/App/App/DynamicTypePlugin.swift`
 * is the cautionary tale in this repo — it has lived here unreferenced by
 * project.pbxproj since it was added, so its JS bridge silently resolves null.
 *
 * These assertions fail loudly if NfcLockPlugin ever drifts into the same state,
 * e.g. after a `cap sync` or an Xcode project regeneration.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoFile = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("NfcLockPlugin is wired into the iOS App target", () => {
  const pbxproj = repoFile("ios/App/App.xcodeproj/project.pbxproj");

  it("has a file reference", () => {
    expect(pbxproj).toMatch(/NfcLockPlugin\.swift \*\/ = \{isa = PBXFileReference;/);
  });

  it("has a build file entry", () => {
    expect(pbxproj).toMatch(/NfcLockPlugin\.swift in Sources \*\/ = \{isa = PBXBuildFile;/);
  });

  it("is listed in the App target's Sources build phase, next to AppDelegate", () => {
    // Scope to the PBXSourcesBuildPhase section — the phase ids also appear
    // earlier in each target's `buildPhases` list.
    const section = pbxproj.slice(
      pbxproj.indexOf("/* Begin PBXSourcesBuildPhase section */"),
      pbxproj.indexOf("/* End PBXSourcesBuildPhase section */"),
    );
    const sourcesPhase = section.slice(
      section.indexOf("504EC3001FED79650016851F /* Sources */"),
      section.indexOf("FE17C00000000000000060 /* Sources */"),
    );
    expect(sourcesPhase).toMatch(/AppDelegate\.swift in Sources/);
    expect(sourcesPhase).toMatch(/NfcLockPlugin\.swift in Sources/);
  });

  it("declares the Capacitor jsName the JS bridge registers", () => {
    const swift = repoFile("ios/App/App/NfcLockPlugin.swift");
    expect(swift).toMatch(/jsName = "NfcLock"/);
    expect(swift).toMatch(/CAPPluginMethod\(name: "lockTag"/);
    expect(repoFile("src/lib/nfc-lock.ts")).toMatch(/registerPlugin<NfcLockPlugin>\("NfcLock"\)/);
  });
});

describe("the NFC entitlement covers the session types the app actually opens", () => {
  const entitlements = repoFile("ios/App/App/App.entitlements");

  it("declares NDEF — @capgo/capacitor-nfc opens NFCNDEFReaderSession by default", () => {
    expect(entitlements).toMatch(/<string>NDEF<\/string>/);
  });

  it("keeps TAG — the plugin's iosSessionType 'tag' path needs it", () => {
    expect(entitlements).toMatch(/<string>TAG<\/string>/);
  });

  it("still declares the usage description CoreNFC requires", () => {
    expect(repoFile("ios/App/App/Info.plist")).toMatch(/NFCReaderUsageDescription/);
  });
});
