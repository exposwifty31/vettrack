/**
 * scripts/resubmit.sh must consult App Store Connect BEFORE choosing a build
 * number. The 2026-09-02 defect: this lane's pbxproj and ios/.last-shipped-build
 * both said 29 while the store already held 30 (the RN lane's upload), so a plain
 * bump proposed 30 — a number App Store Connect would refuse at upload, after the
 * archive. With the oracle on the bump path, the record is synced to the store
 * first and the bump lands above it. Exercised end-to-end in a throwaway fixture
 * repo with stubbed `asc`, `curl` and `railway` on PATH (no network).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RESUBMIT = resolve(process.cwd(), "scripts/resubmit.sh");

function fixture(opts: { pbxBuild: number; record: string; ascMax: string; skipOracle?: boolean; noAsc?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "resubmit-oracle-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  if (!opts.noAsc) {
    stub(
      "asc",
      `cat <<'J'\n{"data":[{"attributes":{"version":"${opts.ascMax}","uploadedDate":"2026-09-02T15:14:50-07:00","processingState":"VALID"}},{"attributes":{"version":"28","uploadedDate":"2026-08-13T00:00:00-07:00","processingState":"VALID"}}]}\nJ`,
    );
  }
  stub("curl", "exit 7"); // every live HTTP gate fails fast, offline
  stub("railway", "exit 1");
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "ios", "App", "App"), { recursive: true });
  mkdirSync(join(repo, "ios", "App", "App.xcodeproj"), { recursive: true });
  writeFileSync(
    join(repo, "ios", "App", "App.xcodeproj", "project.pbxproj"),
    `// fixture\n\t\t\t\tCURRENT_PROJECT_VERSION = ${opts.pbxBuild};\n\t\t\t\tMARKETING_VERSION = 1.3.0;\n\t\t\t\tCURRENT_PROJECT_VERSION = ${opts.pbxBuild};\n\t\t\t\tMARKETING_VERSION = 1.3.0;\n`,
  );
  writeFileSync(
    join(repo, "ios", "App", "App", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>\n<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>\n</dict></plist>\n`,
  );
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture", version: "1.3.0" }));
  writeFileSync(join(repo, "ios", ".last-shipped-build"), opts.record);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    REPO: repo,
    CLERK_SECRET_KEY: "",
  };
  if (opts.skipOracle) env.RESUBMIT_SKIP_STORE_ORACLE = "1";
  const run = spawnSync("bash", [RESUBMIT, "--resubmit"], { encoding: "utf8", env });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const pbx = readFileSync(join(repo, "ios", "App", "App.xcodeproj", "project.pbxproj"), "utf8");
  const build = Number(/CURRENT_PROJECT_VERSION = (\d+);/.exec(pbx)?.[1]);
  const record = readFileSync(join(repo, "ios", ".last-shipped-build"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { code: run.status ?? -1, out, build, record };
}

describe("scripts/resubmit.sh consults the App Store Connect oracle before bumping", () => {
  it("syncs a BEHIND record to the store and bumps above the store's max (the 2026-09-02 shape)", () => {
    // repo 29, record 29, store 30: the old bump proposed 30 — already burnt.
    const r = fixture({ pbxBuild: 29, record: "29\n", ascMax: "30" });
    expect(r.out).toMatch(/RECORD 29 -> 30/);
    expect(r.record).toBe("30\n");
    expect(r.build).toBe(31);
    expect(r.out).toMatch(/build:\s+29 -> 31/);
    // The live gate that follows the bump also states the store max it compared against.
    expect(r.out).toMatch(/build number vs App Store Connect/);
    expect(r.out).toMatch(/PASS\s+build 31 > ASC max 30/);
  });

  it("handles a dotted store max (the RN lane can leave 30.1): record 30.1, next integer build 31", () => {
    const r = fixture({ pbxBuild: 30, record: "30\n", ascMax: "30.1" });
    expect(r.out).toMatch(/RECORD 30 -> 30\.1/);
    expect(r.record).toBe("30.1\n");
    expect(r.build).toBe(31);
    expect(r.out).toMatch(/PASS\s+build 31 > ASC max 30\.1/);
  });

  it("refuses to bump when the oracle is unavailable, and says why (exit 2, nothing edited)", () => {
    const r = fixture({ pbxBuild: 29, record: "29\n", ascMax: "30", noAsc: true });
    expect(r.code).toBe(2);
    expect(r.build).toBe(29);
    expect(r.record).toBe("29\n");
    expect(r.out).toMatch(/RESUBMIT_SKIP_STORE_ORACLE/);
    // The message carries the oracle's real exit code, not the negated `!` status.
    expect(r.out).toMatch(/store-build-max\.sh exit 2/);
  });

  it("RESUBMIT_SKIP_STORE_ORACLE=1 bumps from the local record only, loudly", () => {
    const r = fixture({ pbxBuild: 29, record: "29\n", ascMax: "30", noAsc: true, skipOracle: true });
    expect(r.out).toMatch(/WARNING: RESUBMIT_SKIP_STORE_ORACLE=1/);
    expect(r.build).toBe(30);
    expect(r.record).toBe("29\n");
  });
});
