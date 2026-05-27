#!/usr/bin/env node
/**
 * Run madge --circular on server/ and src/, compare to docs/architecture/baseline-cycles.json.
 * Fails when a cycle exists that is not in the baseline (new cycle).
 * Warns when baseline lists cycles that are no longer detected (safe to update baseline).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const baselinePath = path.join(repoRoot, "docs/architecture/baseline-cycles.json");

function normalizeCycle(line) {
  return line.trim().replace(/\s+/g, " ");
}

function parseMadgeStdout(stdout) {
  const cycles = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\d+\)\s+(.+)$/);
    if (match) {
      cycles.push(normalizeCycle(match[1]));
    }
  }
  return cycles;
}

function runMadge(tree, extensions) {
  const result = spawnSync(
    "pnpm",
    ["exec", "--", "madge", "--circular", "--extensions", extensions, tree],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    },
  );
  const stdout = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const cycles = parseMadgeStdout(stdout);
  // madge exits 1 when cycles are found; that is expected for baselined trees
  if (result.error) {
    console.error(`[compare-cycles] Failed to run madge on ${tree}:`, result.error.message);
    process.exit(2);
  }
  if (result.status !== 0 && result.status !== 1) {
    console.error(`[compare-cycles] madge exited ${result.status} for ${tree}:\n${stdout}`);
    process.exit(2);
  }
  return cycles;
}

function loadBaseline() {
  const raw = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (!raw.cycles || typeof raw.cycles !== "object") {
    throw new Error("baseline-cycles.json: missing cycles object");
  }
  return {
    server: (raw.cycles.server ?? []).map(normalizeCycle),
    src: (raw.cycles.src ?? []).map(normalizeCycle),
  };
}

function compareTree(name, current, baseline) {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  const newCycles = current.filter((c) => !baselineSet.has(c));
  const resolved = baseline.filter((c) => !currentSet.has(c));
  return { newCycles, resolved };
}

function main() {
  console.log("[compare-cycles] Scanning server (extensions: ts)…");
  const serverCurrent = runMadge("server", "ts");
  console.log("[compare-cycles] Scanning src (extensions: ts,tsx)…");
  const srcCurrent = runMadge("src", "ts,tsx");

  const baseline = loadBaseline();
  const server = compareTree("server", serverCurrent, baseline.server);
  const src = compareTree("src", srcCurrent, baseline.src);

  let failed = false;

  for (const [tree, { newCycles, resolved }] of [
    ["server", server],
    ["src", src],
  ]) {
    if (newCycles.length > 0) {
      failed = true;
      console.error(`\n[compare-cycles] NEW circular dependencies in ${tree} (not in baseline):`);
      for (const c of newCycles) {
        console.error(`  - ${c}`);
      }
    }
    if (resolved.length > 0) {
      console.warn(`\n[compare-cycles] Resolved cycles in ${tree} (update baseline-cycles.json):`);
      for (const c of resolved) {
        console.warn(`  - ${c}`);
      }
    }
  }

  if (failed) {
    console.error(
      "\n[compare-cycles] Blocked: add cycles only with an ADR/issue and baseline update, or fix the import graph.",
    );
    process.exit(1);
  }

  console.log(
    `[compare-cycles] OK — server: ${serverCurrent.length} cycle(s), src: ${srcCurrent.length} cycle(s) (matches baseline).`,
  );
}

main();
