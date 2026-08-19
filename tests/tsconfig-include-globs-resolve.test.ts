import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * CLASS GUARD — a tsconfig `include` glob that matches zero files is silent.
 *
 * `tsc` exits 0 when an include pattern resolves to nothing, so a directory
 * rename turns a CI type-check gate into a no-op without any signal. That is
 * exactly how `tsconfig.server-check.json` came to point at `src/shared/**`,
 * `src/lib/constants/**` and `src/lib/forecast/**` — three directories that
 * have never existed at those paths — while gating every PR and every release.
 *
 * Fixing that config was the instance. This is the class: every include glob in
 * every tracked tsconfig must resolve to at least one real file.
 */
const CONFIGS = [
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.server-check.json",
  "tsconfig.node.json",
].filter((file) => existsSync(file));

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "artifacts", "coverage"]);

/** Strip JSONC comments (all four tsconfigs in this repo use them). */
function parseJsonc(source: string): Record<string, unknown> {
  const stripped = source
    .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match, str) => str ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const rest = glob.slice(i);
    if (rest.startsWith("**/")) { out += "(?:[^/]+/)*"; i += 2; continue; }
    if (rest.startsWith("**")) { out += ".*"; i += 1; continue; }
    const char = glob[i]!;
    if (char === "*") { out += "[^/]*"; continue; }
    if (char === "?") { out += "[^/]"; continue; }
    out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * Depth-first search that STOPS at the first hit. Enumerating every file under
 * `src` would make this guard one of the slowest tests in the suite for no gain
 * — the assertion only needs to know whether the count is zero.
 */
function anyFileUnder(dir: string, matches: (file: string) => boolean): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (anyFileUnder(full, matches)) return true;
    } else if (entry.isFile() && matches(full)) {
      return true;
    }
  }
  return false;
}

/** Longest literal path prefix before the first wildcard — bounds the walk. */
function baseDirOf(glob: string): string {
  const firstStar = glob.indexOf("*");
  const head = firstStar === -1 ? glob : glob.slice(0, firstStar);
  const cut = head.lastIndexOf("/");
  return cut === -1 ? "." : head.slice(0, cut);
}

function resolvesToAtLeastOneFile(glob: string): boolean {
  if (!glob.includes("*") && !glob.includes("?")) {
    // tsconfig allows a bare directory, which means "every supported file under it".
    if (!existsSync(glob)) return false;
    return statSync(glob).isDirectory() ? anyFileUnder(glob, () => true) : true;
  }
  const base = baseDirOf(glob);
  if (!existsSync(base)) return false;
  const pattern = globToRegExp(glob);
  return anyFileUnder(base, (file) => pattern.test(file));
}

describe("tsconfig include globs resolve to real files", () => {
  it.each(CONFIGS)("%s — every include glob matches at least one file", (config) => {
    const includes = (parseJsonc(readFileSync(config, "utf8")).include ?? []) as string[];
    expect(includes.length, `${config} declares no include globs`).toBeGreaterThan(0);

    const dead = includes.filter((glob) => !resolvesToAtLeastOneFile(glob));
    expect(
      dead,
      `${config} include globs matching ZERO files: ${dead.join(", ")}. ` +
        `tsc exits 0 on an empty glob, so this silently removes files from a CI gate. ` +
        `Fix the path or delete the entry.`,
    ).toEqual([]);
  });
});
