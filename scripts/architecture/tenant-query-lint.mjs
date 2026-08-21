#!/usr/bin/env node
/**
 * Heuristic tenant query lint (G3 — warn mode by default).
 * Flags Drizzle .from(<tenantTable>) in server/ when the enclosing function body
 * lacks a clinicId reference (identifier or <table>.clinicId).
 *
 * Waivers: // tenant-lint:scoped <reason> on the same line or the line above .from(...)
 *
 * @see docs/architecture/tenant-enforcement.md
 * @see docs/architecture/architecture-hardening-addendum.md §2.5, §9.5
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildTenantTableRegistry, listTenantTables } from "./lib/tenant-tables-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const DEFAULT_SCAN_ROOTS = [
  "server/routes",
  "server/services",
  "server/lib",
  "server/workers",
  "server/middleware",
  "server/integrations",
  "server/domain",
];

const DRIZZLE_FROM_RE = /\.from\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
const WAIVER_RE = /tenant-lint:scoped\s+(.+)/;

/** @typedef {{ file: string, line: number, column: number, table: string, reason: string, waived: boolean, waiverReason?: string }} Finding */

function parseArgs(argv) {
  const opts = {
    warnOnly: true,
    strict: false,
    touched: false,
    all: false,
    stdin: false,
    base: "origin/main",
    paths: [],
    listTables: false,
    baseline: null,
    writeBaseline: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--warn-only":
        opts.warnOnly = true;
        opts.strict = false;
        break;
      case "--strict":
        opts.strict = true;
        opts.warnOnly = false;
        break;
      case "--touched":
        opts.touched = true;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--stdin":
        opts.stdin = true;
        break;
      case "--list-tables":
        opts.listTables = true;
        break;
      case "--base":
        opts.base = argv[++i] ?? opts.base;
        break;
      // --baseline IMPLIES enforcement. It is not a reporting flag: a mode that
      // loads a baseline and then exits 0 regardless is the disarmed gate this
      // whole mechanism exists to replace.
      case "--baseline":
        opts.baseline = argv[++i] ?? null;
        break;
      case "--write-baseline":
        opts.writeBaseline = true;
        break;
      case "--paths":
        while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
          opts.paths.push(argv[++i]);
        }
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith("--")) {
          opts.paths.push(arg);
        } else {
          console.error(`[tenant-lint] Unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/architecture/tenant-query-lint.mjs [options] [paths...]

Options:
  --warn-only       Report findings but exit 0 (default, G3)
  --strict          Exit 1 when findings exist (future G6)
  --touched         Only scan server/ files changed vs --base (git diff)
  --all             Scan default server/ subtrees
  --paths <files>   Explicit file list (repeatable)
  --stdin           Read "path:line:..." lines from stdin (rg pipe)
  --base <ref>      Git base for --touched (default: origin/main)
  --baseline <f>    Fail (exit 1) only on findings absent from baseline file f
  --write-baseline  Regenerate that file from the current scan (with --baseline)
  --list-tables     Print schema-derived TENANT_TABLES and exit
  -h, --help        This message
`);
}

function isDrizzleFromMatch(source, matchIndex) {
  const window = source.slice(Math.max(0, matchIndex - 16), matchIndex);
  if (/\bArray$/i.test(window)) return false;
  if (/\bPromise$/i.test(window)) return false;
  if (/\bSet$/i.test(window)) return false;
  return true;
}

/**
 * @param {string} source
 * @param {number} position
 */
function findEnclosingFunctionBody(source, position) {
  const before = source.slice(0, position);
  const markers = [];

  const fnRe =
    /(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = fnRe.exec(before)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    markers.push({ index: braceStart });
  }

  const arrowRe = /(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{/g;
  while ((m = arrowRe.exec(before)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    markers.push({ index: braceStart });
  }

  const methodRe = /(?:async\s+)?[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*\{/g;
  while ((m = methodRe.exec(before)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    markers.push({ index: braceStart });
  }

  if (markers.length === 0) {
    return source;
  }

  markers.sort((a, b) => b.index - a.index);
  const start = markers[0].index;
  const body = extractBalancedBraces(source, start);
  return body ?? source.slice(start);
}

/**
 * @param {string} source
 * @param {number} openBrace index of '{'
 */
function extractBalancedBraces(source, openBrace) {
  if (source[openBrace] !== "{") return null;
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(openBrace, i + 1);
      }
    }
  }
  return null;
}

/**
 * @param {string} body
 * @param {string} table
 */
function bodyHasClinicScope(body, table) {
  if (/\bclinicId\b/.test(body)) return true;
  const tableClinic = new RegExp(`\\b${escapeRegExp(table)}\\.clinicId\\b`);
  if (tableClinic.test(body)) return true;
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string[]} lines
 * @param {number} lineIndex 0-based
 */
function lineHasWaiver(lines, lineIndex) {
  const check = (idx) => {
    if (idx < 0 || idx >= lines.length) return null;
    const m = lines[idx].match(WAIVER_RE);
    return m ? m[1].trim() : null;
  };
  return check(lineIndex) ?? check(lineIndex - 1) ?? check(lineIndex - 2);
}

/**
 * @param {string} filePath repo-relative
 * @param {Set<string>} tenantTables
 * @returns {Finding[]}
 */
function lintFile(filePath, tenantTables) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  if (!existsSync(abs)) return [];
  if (!abs.includes(`${path.sep}server${path.sep}`)) return [];
  if (!/\.tsx?$/.test(abs)) return [];

  const source = readFileSync(abs, "utf8");
  const lines = source.split("\n");
  /** @type {Finding[]} */
  const findings = [];

  DRIZZLE_FROM_RE.lastIndex = 0;
  let match;
  while ((match = DRIZZLE_FROM_RE.exec(source)) !== null) {
    const table = match[1];
    if (!tenantTables.has(table)) continue;
    if (!isDrizzleFromMatch(source, match.index)) continue;

    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    const column = match.index - before.lastIndexOf("\n");
    const lineIndex = line - 1;

    const waiverReason = lineHasWaiver(lines, lineIndex);
    if (waiverReason) {
      findings.push({
        file: filePath,
        line,
        column,
        table,
        reason: "waived",
        waived: true,
        waiverReason,
      });
      continue;
    }

    const fnBody = findEnclosingFunctionBody(source, match.index);
    if (bodyHasClinicScope(fnBody, table)) continue;

    findings.push({
      file: filePath,
      line,
      column,
      table,
      reason: "missing clinicId in enclosing function scope",
      waived: false,
    });
  }

  return findings;
}

function getTouchedServerFiles(base) {
  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "server/"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== null) {
    console.warn(`[tenant-lint] git diff failed (${result.status}); falling back to --all`);
    return null;
  }
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((f) => f && /\.tsx?$/.test(f));
}

function collectFilesFromStdin() {
  const chunks = [];
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    process.stdin.on("data", (d) => chunks.push(d));
    process.stdin.on("end", () => {
      const files = new Set();
      for (const line of chunks.join("").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const file = trimmed.split(":")[0];
        if (file && file.startsWith("server/")) files.add(file);
      }
      resolve([...files]);
    });
  });
}

/**
 * @param {string} dir
 * @param {string[]} out absolute paths
 */
function walkTs(dir, out) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkTs(abs, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(abs);
    }
  }
}

function expandAllRoots() {
  /** @type {string[]} */
  const files = [];
  for (const root of DEFAULT_SCAN_ROOTS) {
    const dir = path.join(repoRoot, root);
    if (!existsSync(dir)) continue;
    walkTs(dir, files);
  }
  return files.map((abs) => path.relative(repoRoot, abs));
}

/**
 * @param {Finding[]} findings
 */
function printReport(findings, tenantTableCount, scannedCount) {
  const violations = findings.filter((f) => !f.waived);
  const waived = findings.filter((f) => f.waived);

  console.log(
    `[tenant-lint] Scanned ${scannedCount} file(s); registry ${tenantTableCount} tenant table(s).`,
  );

  if (violations.length === 0) {
    console.log("[tenant-lint] No unscoped tenant .from() findings.");
    if (waived.length > 0) {
      console.log(`[tenant-lint] ${waived.length} waived (tenant-lint:scoped).`);
    }
    return;
  }

  console.log(`[tenant-lint] WARN — ${violations.length} possible missing clinicId scope:\n`);
  for (const f of violations) {
    console.log(`  ${f.file}:${f.line}:${f.column}  .from(${f.table}) — ${f.reason}`);
  }
  console.log(
    "\n[tenant-lint] Add // tenant-lint:scoped <reason> on the line above to waive a false positive.",
  );
  if (waived.length > 0) {
    console.log(`[tenant-lint] (${waived.length} waived in scanned files.)`);
  }
}

/**
 * Compare live findings against the committed baseline.
 *
 * WHY A BASELINE AND NOT A CLEANUP FIRST. There are ~200 standing findings, and
 * every one of them has been hand-checked at least once (the audit that produced
 * them found 0 confirmed clinicId gaps). Blocking on all of them means the gate
 * never turns on; leaving it warn-only means a REAL leak is indistinguishable
 * from 200 lines nobody was ever stopped by. Freeze the known set, fail on new.
 *
 * KEYED BY `file::table` AND A COUNT, deliberately not `file:line`. A line number
 * shifts on any unrelated edit above it, so a line-keyed baseline turns ordinary
 * refactors into false regressions and teaches people to regenerate the baseline
 * whenever it goes red — which is the same as not having one. The count is what
 * still catches a SECOND violation of an already-known table in an already-known
 * file, which a bare "is this file/table known?" check would wave straight through.
 *
 * A missing or malformed baseline is zero-tolerance, never a free pass: an
 * unreadable baseline and an empty one must not behave alike.
 *
 * @param {Finding[]} findings live findings (waived ones are ignored here)
 * @param {{ violations?: Record<string, number> }|null|undefined} baseline
 * @returns {{ regressions: {key:string,file:string,table:string,allowed:number,found:number,findings:Finding[]}[], resolved: string[] }}
 */
export function diffAgainstBaseline(findings, baseline) {
  /** @type {Map<string, Finding[]>} */
  const live = new Map();
  for (const f of findings ?? []) {
    if (f.waived) continue;
    const key = `${f.file}::${f.table}`;
    if (!live.has(key)) live.set(key, []);
    live.get(key).push(f);
  }

  const known =
    baseline && typeof baseline === "object" && baseline.violations && typeof baseline.violations === "object"
      ? baseline.violations
      : {};

  const regressions = [];
  for (const [key, group] of live) {
    const allowed = Number.isInteger(known[key]) ? known[key] : 0;
    if (group.length > allowed) {
      const [file, table] = key.split("::");
      regressions.push({ key, file, table, allowed, found: group.length, findings: group });
    }
  }

  // Reported, never failed on. A gate that punishes a PR for FIXING a violation
  // is a gate people learn to route around.
  const resolved = Object.keys(known).filter(
    (k) => (live.get(k)?.length ?? 0) < known[k],
  );

  return { regressions, resolved };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.listTables) {
    const tables = listTenantTables();
    console.log(`[tenant-lint] ${tables.length} tenant table(s):\n${tables.join("\n")}`);
    process.exit(0);
  }

  const tenantTables = buildTenantTableRegistry();

  /** @type {string[]} */
  let files = [...opts.paths];

  if (opts.stdin) {
    files = [...files, ...(await collectFilesFromStdin())];
  } else if (opts.touched) {
    const touched = getTouchedServerFiles(opts.base);
    if (touched === null) {
      files = [...files, ...expandAllRoots()];
    } else if (touched.length === 0) {
      console.log("[tenant-lint] No touched server/ files; skipping scan.");
      process.exit(0);
    } else {
      files = [...files, ...touched];
    }
  } else if (opts.all || files.length === 0) {
    files = [...files, ...expandAllRoots()];
  }

  files = [...new Set(files.map((f) => f.replace(/\\/g, "/")))];

  /** @type {Finding[]} */
  const allFindings = [];
  for (const file of files) {
    allFindings.push(...lintFile(file, tenantTables));
  }

  printReport(allFindings, tenantTables.size, files.length);

  const violationCount = allFindings.filter((f) => !f.waived).length;

  if (opts.baseline) {
    const baselinePath = path.resolve(repoRoot, opts.baseline);
    const live = allFindings.filter((f) => !f.waived);

    if (opts.writeBaseline) {
      const violations = {};
      for (const f of live) {
        const key = `${f.file}::${f.table}`;
        violations[key] = (violations[key] ?? 0) + 1;
      }
      const sorted = Object.fromEntries(Object.entries(violations).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(
        baselinePath,
        `${JSON.stringify(
          {
            $comment:
              "Frozen set of known tenant-lint findings. The gate fails on anything NOT here. " +
              "Keyed file::table with a count, not file:line, so an unrelated edit above a finding " +
              "does not read as a regression. Regenerate ONLY to record a deliberate decision: " +
              "node scripts/architecture/tenant-query-lint.mjs --all --baseline .tenant-lint-known-violations.json --write-baseline",
            totalFindings: live.length,
            violations: sorted,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`[tenant-lint] wrote baseline: ${live.length} findings across ${Object.keys(sorted).length} file::table keys`);
      process.exit(0);
    }

    // An unreadable baseline is a hard failure. Falling back to "no baseline"
    // would silently turn a typo in a path into zero enforcement, which looks
    // exactly like a clean run.
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch (err) {
      console.error(`[tenant-lint] baseline unreadable at ${opts.baseline}: ${err.message}`);
      console.error("[tenant-lint] refusing to run unenforced. Fix the path or regenerate with --write-baseline.");
      process.exit(2);
    }

    const { regressions, resolved } = diffAgainstBaseline(live, baseline);

    if (resolved.length > 0) {
      console.log(`\n[tenant-lint] ${resolved.length} baseline entr(ies) no longer reproduce — tighten the baseline when convenient:`);
      for (const key of resolved) console.log(`  - ${key}`);
    }

    if (regressions.length > 0) {
      console.error(`\n[tenant-lint] ${regressions.length} NEW tenant-scope finding(s) not in the baseline:\n`);
      for (const r of regressions) {
        console.error(`  ${r.key}  (baseline allows ${r.allowed}, found ${r.found})`);
        for (const f of r.findings) console.error(`    ${f.file}:${f.line}:${f.column}  .from(${f.table})`);
      }
      console.error(
        "\n[tenant-lint] Every query must filter by clinicId. Scope the query, or — if this is a" +
          "\n               genuine false positive — waive it on the line above with" +
          "\n               // tenant-lint:scoped <reason>",
      );
      process.exit(1);
    }

    console.log(`\n[tenant-lint] no new findings vs baseline (${live.length} known).`);
    process.exit(0);
  }

  if (opts.strict && violationCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// Only scan when RUN, never when IMPORTED. tests/tenant-lint-baseline.test.ts
// imports `diffAgainstBaseline` to prove the rule; without this guard that import
// would run a full repo scan and call process.exit() out from under the runner.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[tenant-lint] Fatal:", err);
    process.exit(2);
  });
}
