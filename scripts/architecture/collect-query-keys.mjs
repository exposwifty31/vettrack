#!/usr/bin/env node
/**
 * G4 — TanStack Query key discovery and registry drift audit (warn mode by default).
 *
 * Scans src/ for queryKey array literals and *QUERY_KEY constants, normalizes dynamic
 * segments to "*", and compares against src/lib/query-keys/registry.ts.
 *
 * @see docs/architecture/architecture-hardening-addendum.md §7, §9.4
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(repoRoot, "src");
const registryPath = path.join(repoRoot, "src/lib/query-keys/registry.ts");

const QUERY_KEY_PROP_RE = /queryKey\s*:\s*/g;
const CONST_ARRAY_RE =
  /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\[)/g;
const QUERY_KEY_CONST_NAME_RE = /(?:QUERY_KEY|_KEY)$/;

/** @typedef {{ file: string, line: number, signature: string, raw?: string }} Discovery */

function parseArgs(argv) {
  const opts = {
    warnOnly: true,
    strict: false,
    writeRegistry: false,
    list: false,
  };
  for (const arg of argv) {
    if (arg === "--warn-only") opts.warnOnly = true;
    else if (arg === "--strict") {
      opts.strict = true;
      opts.warnOnly = false;
    } else if (arg === "--write-registry") opts.writeRegistry = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/architecture/collect-query-keys.mjs [options]

  --warn-only       Exit 0 with warnings (default, G4)
  --strict          Exit 1 on drift
  --write-registry  Regenerate src/lib/query-keys/registry.ts from current src/
  --list            Print discovered signatures and exit
`);
      process.exit(0);
    }
  }
  return opts;
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walkSrc(dir, out) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkSrc(abs, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(abs);
    }
  }
}

/**
 * @param {string} source
 * @param {number} openBracket index of '['
 * @param {Map<string, string[]>} constMap
 * @returns {{ elements: string[], end: number } | null}
 */
function parseArrayLiteral(source, openBracket, constMap) {
  if (source[openBracket] !== "[") return null;
  /** @type {string[]} */
  const elements = [];
  let i = openBracket + 1;
  const len = source.length;

  while (i < len) {
    while (i < len && /[\s,]/.test(source[i])) i++;
    if (i >= len) return null;
    if (source[i] === "]") {
      return { elements, end: i + 1 };
    }

    if (source.startsWith("...", i)) {
      i += 3;
      while (i < len && /\s/.test(source[i])) i++;
      const idMatch = source.slice(i).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (!idMatch) return null;
      const spreadName = idMatch[1];
      i += spreadName.length;
      const spreadSig = constMap.get(spreadName);
      if (spreadSig) {
        elements.push(...spreadSig);
      } else {
        elements.push("*");
      }
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = "";
      while (i < len) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        str += source[i++];
      }
      elements.push(str);
      continue;
    }

    if (ch === "`") {
      i++;
      let template = "";
      while (i < len) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          const close = findBraceClose(source, i + 2);
          if (close === -1) return null;
          template += "*";
          i = close + 1;
          continue;
        }
        if (source[i] === "`") {
          i++;
          break;
        }
        template += source[i++];
      }
      elements.push(normalizeTemplateStatic(template));
      continue;
    }

    if (ch === "[" ) {
      const nested = parseArrayLiteral(source, i, constMap);
      if (!nested) return null;
      elements.push(JSON.stringify(nested.elements));
      i = nested.end;
      continue;
    }

    const identMatch = source.slice(i).match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
    if (identMatch) {
      elements.push("*");
      i += identMatch[1].length;
      continue;
    }

    return null;
  }
  return null;
}

/**
 * @param {string} source
 * @param {number} start
 */
function findBraceClose(source, start) {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} template static parts joined with * for dynamic segments
 */
function normalizeTemplateStatic(template) {
  if (!template.includes("*")) return template;
  return template.replace(/\*+/g, "*");
}

/**
 * @param {string[]} elements
 */
function normalizeElements(elements) {
  return elements.map((el) => {
    if (el.startsWith("[") && el.endsWith("]")) {
      try {
        const inner = JSON.parse(el);
        if (Array.isArray(inner)) {
          return inner.map((x) => (typeof x === "string" ? x : "*"));
        }
      } catch {
        /* ignore */
      }
    }
    return typeof el === "string" ? el : "*";
  });
}

/**
 * @param {string[]} elements
 */
function toSignature(elements) {
  const normalized = normalizeElements(elements).map((el) =>
    el === "" ? "*" : el,
  );
  return JSON.stringify(normalized);
}

/**
 * @param {string} filePath
 * @param {string} source
 * @param {Map<string, string[]>} globalConstMap
 * @returns {Discovery[]}
 */
function discoverInFile(filePath, source, globalConstMap) {
  /** @type {Discovery[]} */
  const discoveries = [];
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");

  /** @type {Map<string, string[]>} */
  const localConstMap = new Map(globalConstMap);

  CONST_ARRAY_RE.lastIndex = 0;
  let cm;
  while ((cm = CONST_ARRAY_RE.exec(source)) !== null) {
    const name = cm[1];
    const bracket = cm.index + cm[0].length - 1;
    const parsed = parseArrayLiteral(source, bracket, localConstMap);
    if (!parsed) continue;
    const sig = toSignature(parsed.elements);
    localConstMap.set(name, JSON.parse(sig));

    if (QUERY_KEY_CONST_NAME_RE.test(name) || name === "QUERY_KEY" || name === "queryKey") {
      const line = source.slice(0, cm.index).split("\n").length;
      discoveries.push({ file: rel, line, signature: sig });
    }
  }

  const findQueryKeyUsages = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const line = source.slice(0, m.index).split("\n").length;
      const after = m.index + m[0].length;
      const rest = source.slice(after).trimStart();

      if (rest.startsWith("[")) {
        const bracketPos = after + source.slice(after).search(/\[/);
        const parsed = parseArrayLiteral(source, bracketPos, localConstMap);
        if (parsed) {
          discoveries.push({
            file: rel,
            line,
            signature: toSignature(parsed.elements),
          });
        }
      } else {
        const idMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (idMatch) {
          const ref = localConstMap.get(idMatch[1]);
          if (ref) {
            discoveries.push({
              file: rel,
              line,
              signature: JSON.stringify(ref),
            });
          }
        }
      }
    }
  };

  findQueryKeyUsages(QUERY_KEY_PROP_RE);

  const constQueryKeyAssign = /const\s+queryKey\s*=\s*(\[)/g;
  let qa;
  while ((qa = constQueryKeyAssign.exec(source)) !== null) {
    const bracket = qa.index + qa[0].length - 1;
    const parsed = parseArrayLiteral(source, bracket, localConstMap);
    if (parsed) {
      const line = source.slice(0, qa.index).split("\n").length;
      discoveries.push({ file: rel, line, signature: toSignature(parsed.elements) });
    }
  }

  return discoveries;
}

/**
 * @param {string} source
 */
function buildGlobalConstMap(source, filePath, globalConstMap) {
  CONST_ARRAY_RE.lastIndex = 0;
  let cm;
  while ((cm = CONST_ARRAY_RE.exec(source)) !== null) {
    const name = cm[1];
    const bracket = cm.index + cm[0].length - 1;
    const parsed = parseArrayLiteral(source, bracket, globalConstMap);
    if (!parsed) continue;
    const sig = toSignature(parsed.elements);
    globalConstMap.set(name, JSON.parse(sig));
    if (!globalConstMap.has(`@${path.relative(repoRoot, filePath)}::${name}`)) {
      globalConstMap.set(`@${path.relative(repoRoot, filePath)}::${name}`, JSON.parse(sig));
    }
  }
}

/**
 * @returns {Map<string, string[]>}
 */
function buildAllConstMaps(files) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    buildGlobalConstMap(source, file, map);
  }
  return map;
}

/**
 * @returns {Set<string>}
 */
function collectQueryKeySignatures() {
  /** @type {string[]} */
  const files = [];
  walkSrc(srcRoot, files);

  const constMap = buildAllConstMaps(files);
  /** @type {Map<string, Discovery>} */
  const bySignature = new Map();

  for (const file of files) {
    if (file.endsWith("registry.ts") && file.includes("query-keys")) continue;
    const source = readFileSync(file, "utf8");
    for (const d of discoverInFile(file, source, constMap)) {
      if (!bySignature.has(d.signature)) {
        bySignature.set(d.signature, d);
      }
    }
  }

  return new Set(bySignature.keys());
}

/**
 * @returns {Set<string>}
 */
function loadRegistrySignatures() {
  if (!existsSync(registryPath)) {
    return new Set();
  }
  const source = readFileSync(registryPath, "utf8");
  const match = source.match(/REGISTERED_QUERY_KEYS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/);
  if (!match) {
    throw new Error("registry.ts: could not parse REGISTERED_QUERY_KEYS");
  }
  const block = match[1];
  /** @type {Set<string>} */
  const keys = new Set();
  const strRe = /["'`]((?:\\.|[^"'`\\])*)["'`]/g;
  let m;
  while ((m = strRe.exec(block)) !== null) {
    keys.add(m[1].replace(/\\"/g, '"'));
  }
  return keys;
}

/**
 * @param {Set<string>} signatures
 */
function writeRegistry(signatures) {
  const sorted = [...signatures].sort();
  const lines = sorted.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const content = `/**
 * TanStack Query key registry (G4 audit baseline).
 *
 * Do not import from application code — this file exists for architecture drift detection only.
 * Regenerate after intentional new keys: pnpm query-keys:audit -- --write-registry
 *
 * @see scripts/architecture/collect-query-keys.mjs
 * @see docs/architecture/architecture-hardening-addendum.md §9.4
 */
export const QUERY_KEY_REGISTRY_VERSION = 1 as const;

/**
 * Normalized query key shapes (JSON array strings). Dynamic segments are "*".
 */
export const REGISTERED_QUERY_KEYS = [
${lines}
] as const;

export type RegisteredQueryKey = (typeof REGISTERED_QUERY_KEYS)[number];
`;
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, content, "utf8");
  console.log(`[query-keys] Wrote ${sorted.length} signatures to ${path.relative(repoRoot, registryPath)}`);
}

function compareSets(discovered, registered) {
  const missingFromRegistry = [...discovered].filter((k) => !registered.has(k)).sort();
  const orphanInRegistry = [...registered].filter((k) => !discovered.has(k)).sort();
  return { missingFromRegistry, orphanInRegistry };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const discovered = collectQueryKeySignatures();

  if (opts.list) {
    for (const sig of [...discovered].sort()) {
      console.log(sig);
    }
    process.exit(0);
  }

  if (opts.writeRegistry) {
    writeRegistry(discovered);
    process.exit(0);
  }

  const registered = loadRegistrySignatures();
  const { missingFromRegistry, orphanInRegistry } = compareSets(discovered, registered);

  console.log(
    `[query-keys] Discovered ${discovered.size} unique signature(s); registry has ${registered.size}.`,
  );

  if (missingFromRegistry.length === 0 && orphanInRegistry.length === 0) {
    console.log("[query-keys] No drift — registry matches discovered keys.");
    process.exit(0);
  }

  if (missingFromRegistry.length > 0) {
    console.log(`\n[query-keys] WARN — ${missingFromRegistry.length} key(s) in src/ not in registry:\n`);
    for (const sig of missingFromRegistry) {
      console.log(`  ${sig}`);
    }
    console.log("\n[query-keys] Register with: pnpm query-keys:audit -- --write-registry");
  }

  if (orphanInRegistry.length > 0) {
    console.log(`\n[query-keys] WARN — ${orphanInRegistry.length} registry entry(ies) not found in src/:\n`);
    for (const sig of orphanInRegistry) {
      console.log(`  ${sig}`);
    }
  }

  if (opts.strict) {
    process.exit(1);
  }
  process.exit(0);
}

main();
