#!/usr/bin/env node
/**
 * G5 — Express route contract extraction and drift audit (warn mode by default).
 *
 * Derives method + full mounted path + source location from server/app/routes.ts,
 * server/index.ts mounts, and router.* definitions (including nested router.use).
 *
 * @see docs/architecture/architecture-hardening-addendum.md §9.3
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const routesTsPath = path.join(repoRoot, "server/app/routes.ts");
const indexTsPath = path.join(repoRoot, "server/index.ts");
const contractPath = path.join(repoRoot, "docs/architecture/routes-contract.json");

const ROUTER_METHOD_RE = /router\.(get|post|put|patch|delete|all)\s*\(/gi;
const APP_USE_RE = /app\.use\s*\(/g;

const SKIP_APP_USE_IDENT = new Set([
  "express",
  "globalApiLimiter",
  "i18nMiddleware",
  "tenantContext",
  "sessionContextMiddleware",
  "erModeConcealmentMiddleware",
  "clerkMiddleware",
  "compression",
]);

/** @typedef {{
 *   method: string,
 *   path: string,
 *   mountPath: string,
 *   routePath: string,
 *   sourceFile: string,
 *   sourceLine: number,
 *   mountSourceFile: string,
 *   mountLine: number,
 *   pilotGated: boolean,
 * }} RouteEntry */

function parseArgs(argv) {
  const opts = {
    warnOnly: true,
    strict: false,
    writeContract: false,
    list: false,
  };
  for (const arg of argv) {
    if (arg === "--warn-only") opts.warnOnly = true;
    else if (arg === "--strict") {
      opts.strict = true;
      opts.warnOnly = false;
    } else if (arg === "--write-contract") opts.writeContract = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/architecture/extract-express-routes.mjs [options]

  --warn-only         Report drift but exit 0 (default, G5)
  --strict            Exit 1 on contract drift
  --write-contract    Regenerate docs/architecture/routes-contract.json
  --list              Print route count summary
`);
      process.exit(0);
    }
  }
  return opts;
}

/**
 * @param {string} importPath
 * @param {string} fromFile abs path
 */
function resolveModulePath(importPath, fromFile) {
  const base = path.dirname(fromFile);
  let resolved = importPath.startsWith(".")
    ? path.normalize(path.join(base, importPath))
    : path.normalize(path.join(repoRoot, importPath));
  if (resolved.endsWith(".js")) {
    const ts = `${resolved.slice(0, -3)}.ts`;
    if (existsSync(ts)) return ts;
  }
  if (!resolved.endsWith(".ts") && existsSync(`${resolved}.ts`)) {
    return `${resolved}.ts`;
  }
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

/**
 * @param {string} source
 * @param {string} fromFile
 */
function buildImportMap(source, fromFile) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const importRe =
    /import\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    map.set(m[1], resolveModulePath(m[2], fromFile));
  }
  return map;
}

/**
 * @param {string} source
 * @param {number} openParen index of '('
 */
function readFirstStringArg(source, openParen) {
  let i = openParen + 1;
  while (i < source.length && /\s/.test(source[i])) i++;
  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  i++;
  let str = "";
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) {
      return { value: str, end: i + 1 };
    }
    if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      str += ":param";
      continue;
    }
    str += source[i++];
  }
  return null;
}

/**
 * @param {string} mountPath
 * @param {string} routePath
 */
function joinPaths(mountPath, routePath) {
  const m = mountPath.replace(/\/+$/, "") || "";
  const r = routePath.startsWith("/") ? routePath : `/${routePath}`;
  if (!m) return r;
  if (r === "/" || r === "") return m;
  return `${m}${r}`.replace(/\/+/g, "/");
}

/**
 * @param {string} source
 * @param {string} relFile
 */
function findPilotGuardRanges(source, relFile) {
  if (!relFile.endsWith("server/app/routes.ts")) return [];
  /** @type {{ start: number, end: number }[]} */
  const ranges = [];
  const guardIdx = source.indexOf("if (!isPilotMode)");
  if (guardIdx === -1) return ranges;
  const braceStart = source.indexOf("{", guardIdx);
  if (braceStart === -1) return ranges;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        ranges.push({ start: braceStart, end: i });
        break;
      }
    }
  }
  return ranges;
}

/**
 * @param {number} index
 * @param {{ start: number, end: number }[]} ranges
 */
function indexInPilotGuard(index, ranges) {
  return ranges.some((r) => index >= r.start && index <= r.end);
}

/**
 * @param {string} source
 * @param {string} mountSourceFile
 * @param {number} mountLine
 * @param {string} mountPath
 * @param {boolean} pilotGated
 * @param {Map<string, string>} importMap
 * @param {Set<string>} visited
 * @returns {RouteEntry[]}
 */
function extractFromRouterFile(
  source,
  mountSourceFile,
  mountLine,
  mountPath,
  pilotGated,
  importMap,
  visited,
  routeFileRel,
) {
  /** @type {RouteEntry[]} */
  const routes = [];
  const fileKey = `${routeFileRel}::${mountPath}`;
  if (visited.has(fileKey)) return routes;
  visited.add(fileKey);

  ROUTER_METHOD_RE.lastIndex = 0;
  let m;
  while ((m = ROUTER_METHOD_RE.exec(source)) !== null) {
    const method = m[1].toUpperCase();
    const openParen = m.index + m[0].length - 1;
    const str = readFirstStringArg(source, openParen);
    if (!str) continue;
    const routePath = str.value.startsWith("/") ? str.value : `/${str.value}`;
    const line = source.slice(0, m.index).split("\n").length;
    routes.push({
      method,
      path: joinPaths(mountPath, routePath),
      mountPath,
      routePath,
      sourceFile: routeFileRel,
      sourceLine: line,
      mountSourceFile,
      mountLine,
      pilotGated,
    });
  }

  const useRe = /router\.use\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(\w+)/g;
  let um;
  while ((um = useRe.exec(source)) !== null) {
    const subMount = um[2];
    const ident = um[3];
    const subFile = importMap.get(ident);
    if (!subFile || !existsSync(subFile)) continue;
    const subSource = readFileSync(subFile, "utf8");
    const subImportMap = buildImportMap(subSource, subFile);
    const subRel = path.relative(repoRoot, subFile).replace(/\\/g, "/");
    const fullMount = joinPaths(mountPath, subMount);
    routes.push(
      ...extractFromRouterFile(
        subSource,
        mountSourceFile,
        mountLine,
        fullMount,
        pilotGated,
        subImportMap,
        visited,
        subRel,
      ),
    );
  }

  return routes;
}

/**
 * @param {string} inner inside app.use(...)
 */
function splitTopLevelArgs(inner) {
  /** @type {string[]} */
  const args = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) args.push(buf.trim());
  return args;
}

/**
 * @param {string} source
 * @param {number} openParen
 */
function extractAppUseCall(source, openParen) {
  if (source[openParen] !== "(") return null;
  let depth = 0;
  let close = openParen;
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const inner = source.slice(openParen + 1, close);
  const args = splitTopLevelArgs(inner);
  if (args.length === 0) return null;

  let mountPath = null;
  for (const arg of args) {
    const trimmed = arg.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      mountPath = trimmed.slice(1, -1);
      break;
    }
  }
  if (!mountPath) return null;

  let routerIdent = null;
  for (let i = args.length - 1; i >= 0; i--) {
    const trimmed = args[i].trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      routerIdent = trimmed;
      break;
    }
  }
  if (!routerIdent) return null;
  return { mountPath, routerIdent };
}

/**
 * @param {string} source
 * @param {string} relFile
 * @returns {{ mountPath: string, routerIdent: string, line: number, pilotGated: boolean }[]}
 */
function parseAppMounts(source, relFile) {
  const pilotRanges = findPilotGuardRanges(source, relFile);
  /** @type {{ mountPath: string, routerIdent: string, line: number, pilotGated: boolean }[]} */
  const mounts = [];

  APP_USE_RE.lastIndex = 0;
  let m;
  while ((m = APP_USE_RE.exec(source)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const call = extractAppUseCall(source, openParen);
    if (!call) continue;
    const line = source.slice(0, m.index).split("\n").length;
    const pilotGated = indexInPilotGuard(m.index, pilotRanges);
    mounts.push({
      mountPath: call.mountPath,
      routerIdent: call.routerIdent,
      line,
      pilotGated,
    });
  }
  return mounts;
}

/**
 * @returns {RouteEntry[]}
 */
function extractAllRoutes() {
  /** @type {RouteEntry[]} */
  const all = [];
  const files = [
    { abs: routesTsPath, rel: "server/app/routes.ts" },
    { abs: indexTsPath, rel: "server/index.ts" },
  ];

  for (const { abs, rel } of files) {
    if (!existsSync(abs)) continue;
    const source = readFileSync(abs, "utf8");
    const importMap = buildImportMap(source, abs);
    const mounts = parseAppMounts(source, rel);

    for (const mount of mounts) {
      if (SKIP_APP_USE_IDENT.has(mount.routerIdent)) continue;
      if (mount.mountPath === "/assets") continue;
      const routerFile = importMap.get(mount.routerIdent);
      if (!routerFile || !existsSync(routerFile)) {
        console.warn(
          `[routes-contract] Skip mount ${mount.mountPath}: unresolved import ${mount.routerIdent} (${rel})`,
        );
        continue;
      }
      const routerSource = readFileSync(routerFile, "utf8");
      const routerImportMap = buildImportMap(routerSource, routerFile);
      const routerRel = path.relative(repoRoot, routerFile).replace(/\\/g, "/");
      const visited = new Set();
      all.push(
        ...extractFromRouterFile(
          routerSource,
          rel,
          mount.line,
          mount.mountPath,
          mount.pilotGated,
          routerImportMap,
          visited,
          routerRel,
        ),
      );
    }
  }

  const key = (r) => `${r.method} ${r.path}`;
  const deduped = new Map();
  for (const r of all) {
    const k = key(r);
    if (!deduped.has(k)) deduped.set(k, r);
  }
  return [...deduped.values()].sort((a, b) => {
    const pc = a.path.localeCompare(b.path);
    if (pc !== 0) return pc;
    return a.method.localeCompare(b.method);
  });
}

/**
 * @param {RouteEntry[]} routes
 */
function buildContract(routes) {
  const pilotGatedCount = routes.filter((r) => r.pilotGated).length;
  return {
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: "scripts/architecture/extract-express-routes.mjs",
    pilotRegistration: {
      guard: "!isPilotMode",
      sourceFile: "server/app/routes.ts",
      description:
        "When resolveEffectiveRuntimePilotMode() is true, mounts inside if (!isPilotMode) are not registered.",
      gatedRouteCount: pilotGatedCount,
    },
    routeCount: routes.length,
    routes,
  };
}

/**
 * @param {ReturnType<typeof buildContract>} contract
 */
function routeKeys(contract) {
  return contract.routes.map((r) => `${r.method} ${r.path}`);
}

/**
 * @param {ReturnType<typeof buildContract>} a
 * @param {ReturnType<typeof buildContract>} b
 */
function diffContracts(a, b) {
  const keysA = new Set(routeKeys(a));
  const keysB = new Set(routeKeys(b));
  const added = [...keysB].filter((k) => !keysA.has(k)).sort();
  const removed = [...keysA].filter((k) => !keysB.has(k)).sort();
  return { added, removed };
}

function loadContract() {
  if (!existsSync(contractPath)) return null;
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

function writeContract(contract) {
  mkdirSync(path.dirname(contractPath), { recursive: true });
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  console.log(
    `[routes-contract] Wrote ${contract.routeCount} routes (${contract.pilotRegistration.gatedRouteCount} pilot-gated) to docs/architecture/routes-contract.json`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const routes = extractAllRoutes();
  const contract = buildContract(routes);

  if (opts.list) {
    console.log(`[routes-contract] ${contract.routeCount} routes (${contract.pilotRegistration.gatedRouteCount} pilot-gated)`);
    process.exit(0);
  }

  if (opts.writeContract) {
    writeContract(contract);
    process.exit(0);
  }

  const existing = loadContract();
  if (!existing) {
    console.warn(
      "[routes-contract] WARN — no routes-contract.json; run with --write-contract to create baseline.",
    );
    process.exit(opts.strict ? 1 : 0);
  }

  const { added, removed } = diffContracts(existing, contract);

  console.log(
    `[routes-contract] Extracted ${contract.routeCount} routes; contract has ${existing.routeCount ?? existing.routes?.length ?? "?"}.`,
  );

  if (added.length === 0 && removed.length === 0) {
    console.log("[routes-contract] No drift — contract matches extracted routes.");
    process.exit(0);
  }

  if (removed.length > 0) {
    console.log(`\n[routes-contract] WARN — ${removed.length} route(s) removed from contract:\n`);
    for (const k of removed) console.log(`  - ${k}`);
  }
  if (added.length > 0) {
    console.log(`\n[routes-contract] WARN — ${added.length} route(s) added (not in contract):\n`);
    for (const k of added) console.log(`  + ${k}`);
  }
  console.log("\n[routes-contract] Update baseline: pnpm routes:contract -- --write-contract");

  process.exit(opts.strict ? 1 : 0);
}

main();
