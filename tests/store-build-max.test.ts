/**
 * scripts/store-build-max.sh — the App Store Connect oracle for the shared
 * CFBundleVersion counter. Both this repo (Capacitor shell) and the RN lane
 * upload under uk.vettrack.app; on 2026-09-02 the RN lane uploaded build 30
 * while ios/.last-shipped-build here said 29, and the offline gate stayed green
 * on a burnt number for a week. Only the store sees both lanes, so the record
 * becomes a mirror the oracle rewrites with printed proof, never a hand-typed
 * guess. Exercised end-to-end with a stubbed `asc` on PATH (no network).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(process.cwd(), "scripts/store-build-max.sh");

type StubMode = "ok" | "dotted" | "unauth" | "notjson" | "empty" | "absent";

const FIXTURE_OK = JSON.stringify({
  data: [
    { type: "builds", attributes: { version: "28", uploadedDate: "2026-08-13T18:25:00-07:00", processingState: "VALID", expired: false } },
    { type: "builds", attributes: { version: "30", uploadedDate: "2026-09-02T15:14:50-07:00", processingState: "VALID", expired: false } },
    { type: "builds", attributes: { version: "29", uploadedDate: "2026-08-29T00:05:11-07:00", processingState: "VALID", expired: false } },
    { type: "builds", attributes: { version: "5", uploadedDate: "2026-06-12T00:00:00-07:00", processingState: "VALID", expired: true } },
  ],
});
const FIXTURE_DOTTED = JSON.stringify({
  data: [
    { attributes: { version: "30", uploadedDate: "2026-09-02T15:14:50-07:00", processingState: "VALID" } },
    { attributes: { version: "30.1", uploadedDate: "2026-09-03T00:00:00-07:00", processingState: "VALID" } },
  ],
});

function run(mode: StubMode, args: string[] = [], record?: string): { code: number; out: string; record: string | null; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "store-build-max-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  if (mode !== "absent") {
    writeFileSync(
      join(bin, "asc"),
      `#!/bin/bash
# Fake App Store Connect CLI; ignores args except to record them.
printf '%s\\n' "$*" >> "$STUB_ARGS_FILE"
case "$STUB_MODE" in
  ok) cat "$STUB_FIXTURE_OK" ;;
  dotted) cat "$STUB_FIXTURE_DOTTED" ;;
  unauth) echo "Error: no App Store Connect credentials (run asc auth login)" >&2; exit 1 ;;
  notjson) echo "not json <<<" ;;
  empty) echo '{"data":[]}' ;;
esac
exit 0
`,
    );
    chmodSync(join(bin, "asc"), 0o755);
  }
  writeFileSync(join(dir, "ok.json"), FIXTURE_OK);
  writeFileSync(join(dir, "dotted.json"), FIXTURE_DOTTED);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "ios"), { recursive: true });
  if (record !== undefined) writeFileSync(join(repo, "ios", ".last-shipped-build"), record);
  const env = {
    ...process.env,
    // `absent` = a PATH with no asc at all; `command -v asc` must fail.
    PATH: mode === "absent" ? "/usr/bin:/bin" : `${bin}:/usr/bin:/bin`,
    STUB_MODE: mode,
    STUB_ARGS_FILE: join(dir, "args"),
    STUB_FIXTURE_OK: join(dir, "ok.json"),
    STUB_FIXTURE_DOTTED: join(dir, "dotted.json"),
    REPO: repo,
  };
  let code = 0;
  let out = "";
  try {
    out = execFileSync("bash", [SCRIPT, ...args], { encoding: "utf8", env });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    code = e.status ?? 1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const recPath = join(repo, "ios", ".last-shipped-build");
  const rec = existsSync(recPath) ? readFileSync(recPath, "utf8") : null;
  const args_ = existsSync(join(dir, "args")) ? readFileSync(join(dir, "args"), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { code, out: out + "\n[asc args] " + args_, record: rec, dir };
}

describe("scripts/store-build-max.sh — App Store Connect build oracle", () => {
  it("reports the highest build App Store Connect holds, counting expired and all processing states", () => {
    const r = run("ok");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ASC_MAX=30 COUNT=4 LATEST=30@2026-09-02T15:14:50-07:00\/VALID$/m);
    expect(r.out).toContain("--app 6778937527");
    expect(r.out).toContain("--paginate");
    expect(r.out).not.toContain("--exclude-expired");
  });

  it("compares dotted CFBundleVersions numerically, not lexically", () => {
    const r = run("dotted");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ASC_MAX=30\.1 /m);
  });

  it("exits 2 (oracle unavailable) when asc is not on PATH, and says how to get it", () => {
    const r = run("absent");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/asc/);
  });

  it("exits 2 when asc is unauthenticated, surfacing the CLI's own message", () => {
    const r = run("unauth");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/asc auth/);
  });

  it("exits 2 on non-JSON output — never a max of 0", () => {
    const r = run("notjson");
    expect(r.code).toBe(2);
    expect(r.out).not.toMatch(/ASC_MAX=0/);
  });

  it("exits 2 on zero builds — the app has 29, so empty means the wrong app id or key", () => {
    const r = run("empty");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/zero builds|no builds/i);
  });

  it("--sync raises a record that is BEHIND the store and prints the proof", () => {
    const r = run("ok", ["--sync"], "29\n");
    expect(r.code).toBe(0);
    expect(r.record).toBe("30\n");
    expect(r.out).toMatch(/RECORD 29 -> 30/);
    expect(r.out).toMatch(/proof: asc builds list/);
  });

  it("--sync leaves a record that already matches the store untouched", () => {
    const r = run("ok", ["--sync"], "30\n");
    expect(r.code).toBe(0);
    expect(r.record).toBe("30\n");
    expect(r.out).toMatch(/in sync/);
  });

  it("--sync REFUSES to lower a record that is AHEAD of the store (exit 1, file untouched)", () => {
    const r = run("ok", ["--sync"], "31\n");
    expect(r.code).toBe(1);
    expect(r.record).toBe("31\n");
    expect(r.out).toMatch(/AHEAD/);
  });

  it("--sync fails closed when the oracle is unavailable (record untouched)", () => {
    const r = run("unauth", ["--sync"], "29\n");
    expect(r.code).toBe(2);
    expect(r.record).toBe("29\n");
  });
});
