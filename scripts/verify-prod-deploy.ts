#!/usr/bin/env tsx
/**
 * Poll production /api/version until gitCommit matches target, then run API smoke probes.
 * Usage: tsx scripts/verify-prod-deploy.ts <target-sha-prefix> [--timeout 600] [--prod https://vettrack.uk]
 */
import { execSync } from "node:child_process";

const PROD = process.argv.includes("--prod")
  ? process.argv[process.argv.indexOf("--prod") + 1]
  : "https://vettrack.uk";

const timeoutIdx = process.argv.indexOf("--timeout");
const TIMEOUT_MS =
  timeoutIdx >= 0 ? Number(process.argv[timeoutIdx + 1]) * 1000 : 600_000;

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const TARGET = (
  positional[0] ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
).replace(/^origin\//, "").slice(0, 8);

const POLL_MS = 10_000;

type VersionPayload = {
  gitCommit?: string | null;
  pilotMode?: { backend?: boolean; frontend?: boolean; mismatch?: boolean };
};

async function fetchJson<T>(path: string): Promise<{ status: number; ct: string; body: T }> {
  const res = await fetch(`${PROD}${path}`, {
    headers: { Accept: "application/json" },
  });
  const ct = res.headers.get("content-type") ?? "";
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, ct, body };
}

async function waitForDeploy(): Promise<VersionPayload> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { body } = await fetchJson<VersionPayload>("/api/version");
    const commit = body.gitCommit?.slice(0, 8) ?? "";
    console.log(`[poll] gitCommit=${commit} target=${TARGET}`);
    if (commit === TARGET) return body;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timeout: production gitCommit did not match ${TARGET} within ${TIMEOUT_MS / 1000}s`);
}

async function probeApi(path: string): Promise<boolean> {
  const res = await fetch(`${PROD}${path}`, { headers: { Accept: "application/json" } });
  const ct = res.headers.get("content-type") ?? "";
  const ok = res.status === 401 && ct.includes("application/json");
  console.log(
    `${ok ? "PASS" : "FAIL"} ${path} status=${res.status} content-type=${ct.split(";")[0]}`,
  );
  return ok;
}

async function main(): Promise<void> {
  console.log(`=== verify-prod-deploy ===`);
  console.log(`PROD=${PROD} TARGET=${TARGET} TIMEOUT=${TIMEOUT_MS / 1000}s`);

  const version = await waitForDeploy();

  let pass = true;
  const pilot = version.pilotMode;
  if (pilot?.backend !== false || pilot?.frontend !== false || pilot?.mismatch !== false) {
    console.log("FAIL pilotMode", pilot);
    pass = false;
  } else {
    console.log("PASS pilotMode", pilot);
  }

  for (const path of [
    "/api/appointments",
    "/api/medication-tasks",
    "/api/billing",
    "/api/tasks/dashboard",
    "/api/shift-handover/summary",
    "/api/clinical/me/active",
  ]) {
    if (!(await probeApi(path))) pass = false;
  }

  const health = await fetchJson<{ status?: string; checks?: Record<string, string> }>("/api/health");
  console.log(`health status=${health.status} checks=${JSON.stringify(health.body.checks)}`);
  if (health.body.checks?.worker !== "ok") {
    console.log("WARN worker check is not ok (redeploy Worker after #508 merge)");
  }

  if (!pass) process.exit(1);
  console.log("=== ALL PROBES PASS ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
