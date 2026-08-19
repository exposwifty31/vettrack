import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";

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
/**
 * Every config a CI gate type-checks against. NOT filtered by existsSync: dropping a
 * missing file would turn a renamed or deleted config into a silent pass here while the
 * gate that runs `tsc --project` on it breaks — the same shape of failure this whole
 * test exists to catch.
 *
 * The two package configs are gated by their own CI jobs, not by the root type-check:
 * `.github/workflows/ci.yml` runs `pnpm rfid-controller:typecheck`, and
 * `scripts/ci/contracts-gate.sh` runs `pnpm contracts:typecheck`. The contracts gate
 * points at `node_modules/@vettrack/contracts/tsconfig.json`, which is a workspace
 * symlink to `packages/contracts` — the real path is listed here so the walk does not
 * have to descend into node_modules.
 */
const CI_CHECKED = [
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.server-check.json",
  "packages/rfid-controller/tsconfig.json",
  "packages/contracts/tsconfig.json",
];
const CONFIGS = [...CI_CHECKED, "tsconfig.node.json"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "artifacts", "coverage"]);

/** Strip JSONC comments (all four root tsconfigs in this repo use them). */
function parseJsonc(source: string): Record<string, unknown> {
  const stripped = source
    .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match, str) => str ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}

/**
 * `parseJsonc` yields `unknown`. Casting straight to `string[]` means a malformed field
 * — a bare string, a number in the list — reaches `.filter()` and throws a TypeError
 * naming neither the config nor the value. Fail here instead, with both.
 */
function globList(config: string, field: "include" | "exclude"): string[] {
  const raw: unknown = parseJsonc(readFileSync(config, "utf8"))[field] ?? [];
  if (!Array.isArray(raw) || !raw.every((glob): glob is string => typeof glob === "string")) {
    throw new Error(
      `${config} declares a "${field}" that is not an array of strings: ` +
        `${JSON.stringify(raw)}. tsc would reject this config, so the gate that runs ` +
        `against it is already broken.`,
    );
  }
  return raw;
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const rest = glob.slice(i);
    if (rest.startsWith("**/")) { out += "(?:[^/]+/)*"; i += 2; continue; }
    if (rest.startsWith("**")) { out += ".*"; i += 1; continue; }
    const char = glob.charAt(i);
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

/**
 * tsconfig globs are relative to the config's OWN directory, not the repo root.
 * `packages/rfid-controller/tsconfig.json` includes `"src"`, and resolving that from
 * the root would match the frontend's `src/` — a pass for entirely the wrong directory,
 * which is the exact failure mode this file exists to catch.
 */
function resolvesToAtLeastOneFile(glob: string, configDir: string): boolean {
  const rooted = join(configDir, glob);
  if (!rooted.includes("*") && !rooted.includes("?")) {
    // tsconfig allows a bare directory, which means "every supported file under it".
    if (!existsSync(rooted)) return false;
    return statSync(rooted).isDirectory() ? anyFileUnder(rooted, () => true) : true;
  }
  const base = baseDirOf(rooted);
  if (!existsSync(base)) return false;
  const pattern = globToRegExp(rooted);
  return anyFileUnder(base, (file) => pattern.test(file));
}

describe("tsconfig include globs resolve to real files", () => {
  it.each(CI_CHECKED)("%s exists — a CI gate type-checks against it", (config) => {
    expect(
      existsSync(config),
      `${config} is missing but a CI gate runs tsc against it; renaming a config must ` +
        `update the workflow, not silently skip this check.`,
    ).toBe(true);
  });

  it.each(CONFIGS)("%s — every include glob matches at least one file", (config) => {
    const configDir = dirname(config);
    const includes = globList(config, "include");
    expect(includes.length, `${config} declares no include globs`).toBeGreaterThan(0);

    const dead = includes.filter((glob) => !resolvesToAtLeastOneFile(glob, configDir));
    expect(
      dead,
      `${config} include globs matching ZERO files: ${dead.join(", ")}. ` +
        `tsc exits 0 on an empty glob, so this silently removes files from a CI gate. ` +
        `Fix the path or delete the entry.`,
    ).toEqual([]);
  });

  it.each(CONFIGS)("%s — every exclude glob matches at least one file", (config) => {
    // Dead excludes were half of the original defect: tsconfig.server-check.json
    // excluded two paths its (also-dead) includes had never matched, so the file read
    // as if it were narrowing a real check when it was narrowing nothing. An exclude
    // matching zero files is either a stale path or a misunderstanding of the include
    // set — both worth failing on.
    const configDir = dirname(config);
    const excludes = globList(config, "exclude");
    const dead = excludes.filter((glob) => !resolvesToAtLeastOneFile(glob, configDir));
    expect(
      dead,
      `${config} exclude globs matching ZERO files: ${dead.join(", ")}. ` +
        `A dead exclude misrepresents what the gate skips. Fix the path or delete the entry.`,
    ).toEqual([]);
  });
});
