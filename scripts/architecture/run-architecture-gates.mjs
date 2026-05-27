#!/usr/bin/env node
/**
 * Local G1 architecture gates (see docs/architecture/tooling-syntax-verification.md).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function run(label, command, args, options = {}) {
  console.log(`\n[architecture-gates] ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`[architecture-gates] Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run("TypeScript (frontend)", "pnpm", ["exec", "tsc", "--noEmit"]);
run("TypeScript (server)", "pnpm", ["exec", "tsc", "--noEmit", "--project", "tsconfig.server-check.json"]);
run("dependency-cruiser", "pnpm", [
  "exec",
  "--",
  "depcruise",
  "--config",
  ".dependency-cruiser.cjs",
  "--output-type",
  "err",
  "--ignore-known",
  ".dependency-cruiser-known-violations.json",
  "server",
  "src",
]);
run("madge cycle baseline", "node", ["scripts/architecture/compare-cycles.mjs"]);

console.log("\n[architecture-gates] All G1 checks passed.");
