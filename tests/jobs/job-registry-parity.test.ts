/**
 * E3 — Job registry / enqueue parity tripwire.
 * Ensures every static BullMQ job.name used on production enqueue paths is defined
 * in {@link staticJobDefinitions} (Job registry 1b). Integration sync uses dynamic names
 * and is tracked separately via integration-sync-enqueue metadata.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  integrationSyncEnqueueDefinition,
  resolveBullmqJobName,
  staticJobDefinitions,
} from "../../server/jobs/definitions/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Frozen snapshot of registry-backed static BullMQ job names (sorted). */
const REGISTRY_STATIC_BULLMQ_JOB_NAMES = [
  ...staticJobDefinitions.map((def) => resolveBullmqJobName(def)),
].sort();

const INTEGRATION_ENQUEUE_KIND = integrationSyncEnqueueDefinition.kind;

const PRODUCTION_SCAN_ROOTS = ["server"] as const;
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

/** Queues outside Job registry 1b — not compared to static definitions. */
const SKIP_REL_FILES = new Set([
  "server/workers/notification.worker.ts",
  "server/lib/queue.ts",
  "server/routes/queue.ts",
]);

/** Literal job names on legacy notification / DLQ paths (ignored when scanned). */
const IGNORE_STATIC_JOB_NAME_LITERALS = new Set([
  "send_notification",
  "scan_overdue_reminders",
  "automation_tick",
  "automation_execute",
  "billing_webhook",
  "shift_report_email",
  "dead_letter",
]);

/** Names used only from tests/ — never required in registry. */
const TEST_ONLY_JOB_NAME_LITERALS = new Set(["e3-parity-poison-job"]);

/** First .add() args that are payloads or computed names, not static registry literals. */
const IGNORE_FIRST_ADD_ARG_IDENTIFIERS = new Set([
  "data",
  "jobName",
  "sourceName",
  "payload",
]);

type DiscoveredEnqueueRef = `${string}:${string}`;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function buildJobNameConstantMap(): Map<string, string> {
  const map = new Map<string, string>();
  const constPattern =
    /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*_JOB_NAME)\s*=\s*["']([^"']+)["']/g;

  for (const root of PRODUCTION_SCAN_ROOTS) {
    const absRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absRoot)) continue;
    for (const filePath of collectSourceFiles(absRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const match of source.matchAll(constPattern)) {
        map.set(match[1], match[2]);
      }
    }
  }
  return map;
}

const JOB_NAME_CONSTANTS = buildJobNameConstantMap();

function isNonBullmqCollectionAdd(line: string): boolean {
  return /\b(?:seen|clients|kinds|names|set|unique|current|alertedSessions|seenReasons|seenName|seenSeniorSlot|deletedByComposite|seenSerials|initFailedQueueNames)\.add\s*\(/.test(
    line,
  );
}

/** Clinic-scoped queue wrappers pass payload only; job.name is set inside the wrapper. */
function isQueueWrapperPayloadEnqueue(line: string): boolean {
  return /\b\w+Queue\.add\s*\(\s*(?:data|\{)/.test(line);
}

function isLikelyBullmqEnqueueLine(line: string): boolean {
  if (isNonBullmqCollectionAdd(line)) return false;
  if (isQueueWrapperPayloadEnqueue(line)) return false;
  if (!/\.add\s*\(/.test(line)) return false;
  return (
    /[Qq]ueue\.add\s*\(/.test(line) ||
    /\bq\.add\s*\(/.test(line) ||
    /chargeAlertQueue\.add\s*\(/.test(line) ||
    /expiryCheckQueue\.add\s*\(/.test(line) ||
    /sweepQueue\.add\s*\(/.test(line) ||
    /integrationQueue\.add\s*\(/.test(line) ||
    /return\s+q\.add\s*\(/.test(line) ||
    /queue\.add\s*\(/.test(line)
  );
}

function isDynamicIntegrationJobNameExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed.startsWith("`")) return true;
  if (/integrationBullmqJobName\s*\(/.test(trimmed)) return true;
  if (/^\$\{/.test(trimmed)) return true;
  return false;
}

function parseAddFirstArgFromFragment(fragment: string): string | null {
  let i = 0;
  while (i < fragment.length && /\s/.test(fragment[i])) i++;
  if (i >= fragment.length) return null;

  const ch = fragment[i];
  if (ch === '"' || ch === "'") {
    const quote = ch;
    let j = i + 1;
    let value = "";
    while (j < fragment.length && fragment[j] !== quote) {
      value += fragment[j];
      j++;
    }
    return value;
  }

  if (ch === "`") return "`";
  if (ch === "{") return null;

  const identMatch = fragment.slice(i).match(/^([A-Z][A-Z0-9_]*_JOB_NAME)\b/);
  if (identMatch) return identMatch[1];

  const identMatch2 = fragment.slice(i).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\b/);
  if (identMatch2) return identMatch2[1];

  return null;
}

function extractFirstAddArg(line: string): string | null {
  const addIdx = line.indexOf(".add(");
  if (addIdx < 0) return null;
  return parseAddFirstArgFromFragment(line.slice(addIdx + 5));
}

function extractFirstAddArgFromMultiline(lines: string[], lineNo: number): string | null {
  const line = lines[lineNo];
  const onSameLine = extractFirstAddArg(line);
  if (onSameLine) return onSameLine;

  if (!/\.add\s*\(\s*$/.test(line.replace(/\s+$/, ""))) return null;

  for (let j = lineNo + 1; j < Math.min(lineNo + 6, lines.length); j++) {
    const cont = lines[j].trim();
    if (!cont || cont.startsWith("//")) continue;
    const parsed = parseAddFirstArgFromFragment(cont);
    if (parsed) return parsed;
    if (cont.startsWith("{") || /^data\b/.test(cont)) return null;
  }
  return null;
}

function resolveStaticJobName(raw: string): string | "dynamic" | null {
  if (raw === "`" || isDynamicIntegrationJobNameExpr(raw)) return "dynamic";
  if (IGNORE_FIRST_ADD_ARG_IDENTIFIERS.has(raw)) return null;
  if (JOB_NAME_CONSTANTS.has(raw)) return JOB_NAME_CONSTANTS.get(raw)!;
  if (IGNORE_STATIC_JOB_NAME_LITERALS.has(raw)) return null;
  if (TEST_ONLY_JOB_NAME_LITERALS.has(raw)) return null;
  return raw;
}

function discoverProductionEnqueueJobNames(): {
  staticNames: Set<string>;
  dynamicIntegrationRefs: DiscoveredEnqueueRef[];
} {
  const staticNames = new Set<string>();
  const dynamicIntegrationRefs: DiscoveredEnqueueRef[] = [];

  for (const root of PRODUCTION_SCAN_ROOTS) {
    const absRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absRoot)) continue;

    for (const filePath of collectSourceFiles(absRoot)) {
      const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
      if (SKIP_REL_FILES.has(rel)) continue;

      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        if (!isLikelyBullmqEnqueueLine(line)) continue;

        const firstArg = extractFirstAddArgFromMultiline(lines, lineNo);
        if (!firstArg) continue;

        const resolved = resolveStaticJobName(firstArg);
        if (resolved === "dynamic") {
          dynamicIntegrationRefs.push(`${rel}:${lineNo + 1}`);
          continue;
        }
        if (resolved === null) continue;
        staticNames.add(resolved);
      }
    }
  }

  return { staticNames, dynamicIntegrationRefs };
}

function discoverEnqueueJobKindLiteralsInServer(): Set<string> {
  const kinds = new Set<string>();
  const pattern = /\benqueueJob\s*\(\s*["']([^"']+)["']/g;
  const serverRoot = path.join(repoRoot, "server");
  for (const filePath of collectSourceFiles(serverRoot)) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(pattern)) {
      kinds.add(match[1]);
    }
  }
  return kinds;
}

function isTestOnlyJobNameLiteral(name: string): boolean {
  return TEST_ONLY_JOB_NAME_LITERALS.has(name);
}

describe("E3 — job registry / enqueue parity", () => {
  it("registry static bullmq job names match frozen snapshot", () => {
    expect(REGISTRY_STATIC_BULLMQ_JOB_NAMES).toMatchInlineSnapshot(`
      [
        "check-expiry",
        "check-plug",
        "stale-task-ownership-sweep",
        "sweep-room-escalation",
        "sweep-stale-checkins",
        "sweep-stale-checkouts",
        "sweep-stale-returned",
        "task-ownership-backfill",
      ]
    `);
  });

  it("integration enqueue kind is registered separately from static names", () => {
    expect(INTEGRATION_ENQUEUE_KIND).toBe("integration-sync-enqueue");
    expect(REGISTRY_STATIC_BULLMQ_JOB_NAMES).not.toContain(INTEGRATION_ENQUEUE_KIND);
  });

  it("every static job name on production enqueue paths exists in registry definitions", () => {
    const { staticNames, dynamicIntegrationRefs } = discoverProductionEnqueueJobNames();
    const enqueueJobKinds = discoverEnqueueJobKindLiteralsInServer();

    const registrySet = new Set(REGISTRY_STATIC_BULLMQ_JOB_NAMES);
    const discovered = new Set([...staticNames, ...enqueueJobKinds]);
    const missing = [...discovered].filter((name) => !registrySet.has(name)).sort();

    expect(
      missing,
      missing.length
        ? `Enqueue paths reference job names missing from staticJobDefinitions:\n${missing.map((n) => `  - ${n}`).join("\n")}`
        : undefined,
    ).toEqual([]);

    expect(
      dynamicIntegrationRefs.length,
      "integration sync must enqueue via dynamic job.name (template or integrationBullmqJobName)",
    ).toBeGreaterThan(0);

    expect([...discovered].sort()).toMatchInlineSnapshot(`
      [
        "check-expiry",
        "check-plug",
        "stale-task-ownership-sweep",
        "sweep-room-escalation",
        "sweep-stale-checkins",
        "sweep-stale-checkouts",
        "sweep-stale-returned",
        "task-ownership-backfill",
      ]
    `);
  });

  it("ignores test-only enqueue job name literals in production scan", () => {
    const { staticNames } = discoverProductionEnqueueJobNames();
    for (const name of TEST_ONLY_JOB_NAME_LITERALS) {
      expect(staticNames.has(name)).toBe(false);
      expect(isTestOnlyJobNameLiteral(name)).toBe(true);
      expect(resolveStaticJobName(name)).toBeNull();
    }
  });

  it("detects unregistered static job names (poison)", () => {
    const registrySet = new Set(REGISTRY_STATIC_BULLMQ_JOB_NAMES);
    const poison = "e3-parity-poison-job";
    expect(registrySet.has(poison)).toBe(false);
    expect(resolveStaticJobName(poison)).toBeNull();

    const fakeDiscovered = new Set(["check-plug", poison]);
    const missing = [...fakeDiscovered].filter((n) => !registrySet.has(n));
    expect(missing).toEqual([poison]);
  });

  it("classifies BullMQ .add lines vs collection .add", () => {
    expect(isLikelyBullmqEnqueueLine("    return q.add(INVENTORY_DEDUCTION_JOB_NAME, data, {")).toBe(
      true,
    );
    expect(isLikelyBullmqEnqueueLine("        seenSerials.add(serialLower);")).toBe(false);
    expect(isLikelyBullmqEnqueueLine("      await admissionFanoutQueue.add(data);")).toBe(false);
    expect(isLikelyBullmqEnqueueLine("  return queue.add(jobName, data, {")).toBe(true);
    expect(
      isLikelyBullmqEnqueueLine(
        '    return q.add(`${data.adapterId}:${data.syncType}:${data.direction}`, data, {',
      ),
    ).toBe(true);
  });
});
