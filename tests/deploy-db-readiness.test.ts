/**
 * Behavioral coverage for the post-deploy DB-readiness gate
 * (scripts/check-db-readiness.sh), which fails a Railway deploy unless
 * /api/health reports checks.db == "ok". Introduced after the 2026-07-14 prod
 * outage where a broken runtime pool shipped "green" past a liveness-only gate.
 *
 * The script is exercised end-to-end with a stubbed `curl` on PATH (no network),
 * driving each branch: immediate ok, persistent failure, unreachable, malformed
 * body, and fail→ok recovery within the retry window. Retry/sleep are collapsed
 * to near-zero via the env tunables so the suite stays fast.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(process.cwd(), "scripts/check-db-readiness.sh");

const hasJq = (() => {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (!hasJq) {
  // Loud signal on skip: this suite is the safety net after an outage that shipped
  // past a liveness-only gate. jq is a hard dependency of deploy.sh and is present on
  // CI runners, so a silent skip here (especially in CI) would quietly zero out the
  // gate's coverage — exactly the class of invisible gap we're guarding against.
  console.warn(
    "[deploy-db-readiness] jq not found on PATH — SKIPPING the DB-readiness gate suite. " +
      "This must run in CI (deploy.sh requires jq); investigate if you see this in CI logs.",
  );
}

type StubMode = "ok" | "fail" | "unreachable" | "malformed" | "recovery";

// Runs the gate with a fake `curl` (and its own fresh counter file) on PATH.
// Returns the exit code and combined stdout/stderr.
function runGate(mode: StubMode): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "readiness-stub-"));
  const stub = join(dir, "curl");
  writeFileSync(
    stub,
    `#!/bin/bash
# Ignores curl args; emits a controlled /api/health body by STUB_MODE.
case "$STUB_MODE" in
  ok) echo '{"status":"ok","checks":{"db":"ok"}}' ;;
  fail) echo '{"status":"degraded","checks":{"db":"fail"}}' ;;
  unreachable) exit 7 ;;
  malformed) echo 'not json <<<' ;;
  recovery)
    n=0; [ -f "$STUB_COUNTER_FILE" ] && n=$(cat "$STUB_COUNTER_FILE")
    n=$((n+1)); echo "$n" > "$STUB_COUNTER_FILE"
    if [ "$n" -ge 2 ]; then echo '{"checks":{"db":"ok"}}'; else echo '{"checks":{"db":"fail"}}'; fi ;;
esac
exit 0
`,
  );
  chmodSync(stub, 0o755);
  try {
    const out = execFileSync("bash", [SCRIPT, "http://stub.local/api/health"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        STUB_MODE: mode,
        STUB_COUNTER_FILE: join(dir, "count"),
        READINESS_MAX_ATTEMPTS: "3",
        READINESS_SLEEP_SECS: "0",
        READINESS_CURL_TIMEOUT: "1",
      },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasJq)("deploy DB-readiness gate (scripts/check-db-readiness.sh)", () => {
  it("passes (exit 0) when checks.db is ok on the first attempt", () => {
    const r = runGate("ok");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DB readiness OK/);
  });

  it("fails the deploy (exit 1) when checks.db stays fail across all attempts", () => {
    const r = runGate("fail");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/readiness failed/i);
  });

  it("fails the deploy (exit 1) when the endpoint is unreachable (curl errors, no body)", () => {
    const r = runGate("unreachable");
    expect(r.code).toBe(1);
  });

  it("fails the deploy (exit 1) on a malformed (non-JSON) response", () => {
    const r = runGate("malformed");
    expect(r.code).toBe(1);
  });

  it("recovers (exit 0) when db flips fail → ok within the retry window", () => {
    const r = runGate("recovery");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DB readiness OK/);
  });
});
