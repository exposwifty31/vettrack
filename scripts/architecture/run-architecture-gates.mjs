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

// Tenant scope: every query filters clinicId. This gate was absent from this
// runner entirely, and its CI step was disarmed twice over (`--warn-only`, whose
// own --help says "exit 0", inside a `continue-on-error: true` step). A real
// clinicId leak was therefore indistinguishable from ~200 standing findings that
// had never blocked anyone. The baseline freezes the known set so only NEW
// findings fail — see .tenant-lint-known-violations.json for how to regenerate.
run("tenant query lint (new findings only)", "node", [
  "scripts/architecture/tenant-query-lint.mjs",
  "--all",
  "--baseline",
  ".tenant-lint-known-violations.json",
]);

// Claim verification: every path, version, script, absence, landing citation and
// attestation in a governed document must be accounted for. Same engine as
// `pnpm verify:claims` and as the vitest gate in tests/claims-ledger.test.ts.
run("claim verification", "node", ["scripts/verify-claims.mjs"]);

console.log("\n[architecture-gates] All G1 checks passed.");
