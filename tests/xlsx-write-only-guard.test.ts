/**
 * Guard: the `xlsx` (SheetJS CE) dependency must stay WRITE-ONLY and EXACTLY PINNED.
 *
 * Why this exists
 * ---------------
 * `xlsx@0.18.5` carries two HIGH advisories that will never be fixed on npm,
 * because SheetJS stopped publishing there — the patched builds are CDN-only,
 * so `npm install xlsx@latest` resolves right back to the vulnerable 0.18.5:
 *
 *   CVE-2023-30533 (GHSA-4r6h-8v6p-xvw6) — prototype pollution, fixed in 0.19.3.
 *     The advisory text exempts this repo's usage by name:
 *       "All versions of SheetJS CE through 0.19.2 are vulnerable to 'Prototype
 *        Pollution' WHEN READING specially crafted files. Workflows that do not
 *        read arbitrary files (for example, exporting data to spreadsheet files)
 *        are unaffected."
 *
 *   CVE-2024-22363 (GHSA-5pgg-2g8v-p4x9) — ReDoS, CVSS 7.5, fixed in 0.20.2.
 *     NOT exempted by any text. GHSA, NVD, and the SheetJS vendor advisory all
 *     decline to name the affected code path. The risk here is bounded by
 *     measurement, not by a citation — see "Evidence" below.
 *
 * We therefore accept the risk rather than patch it, and the entire basis for
 * accepting it is that this repo NEVER PARSES a spreadsheet — it only serialises
 * rows it already holds. That basis is one careless import away from becoming
 * false, and until now it lived only as prose in an audit finding. This test
 * makes it a CI assertion instead.
 *
 * Evidence on record (2026-08-18, xlsx 0.18.5)
 * -------------------------------------------
 *   - `pnpm why xlsx` -> single direct production dependency, no transitive path.
 *   - Instrumented probe of the real export path (`json_to_sheet` -> `book_new`
 *     -> `book_append_sheet` -> `write`) touched zero read APIs.
 *   - Adversarial cell text (ReDoS-shaped: 32k digit runs, nested quantifier
 *     bait, currency/scientific/cell-ref lookalikes) serialised in 1.1-5.9 ms —
 *     no super-linear backtracking observed. SheetJS additionally hard-caps cell
 *     text at 32767 chars (xlsx.mjs:14884, "Text length must not exceed 32767
 *     characters"), which bounds the input to any regex on the write path.
 *   - The module is lazily chunked (see vite.config.ts) and dynamically imported,
 *     so it is not resident until a user clicks Export.
 *
 * Rejected alternatives (deliberate, not overlooked)
 * -------------------------------------------------
 *   - Swap to `@e965/xlsx` (fork republishing patched SheetJS to npm) or to a
 *     write-only library. Both change the bytes of a shipped user-facing export
 *     and are feature-tier under `.claude/rules/phase-delivery.md` — out of scope
 *     for a dependency-residue sweep, and worth doing on its own branch.
 *   - Vendoring the CDN build: adds an unauditable binary blob to the repo.
 *
 * If a future change needs to READ spreadsheets, this test fails — correctly.
 * The fix then is not to edit this test: it is to stop accepting the risk and
 * move off unmaintained SheetJS, because the exemption above no longer applies.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

/** The one file allowed to depend on xlsx. */
const SOLE_IMPORTER = "src/lib/export-excel.ts";

/** Trees that ship. `tests/` and `scripts/` are deliberately out of scope. */
const SCANNED_TREES = ["src", "server"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

/**
 * Matches `xlsx` only in module-specifier position: `from "xlsx"`,
 * `import("xlsx")`, `require("xlsx")`, plus any subpath. Deliberately does NOT
 * match a bare `.xlsx` filename string — `src/pages/equipment-list.tsx` names
 * the download `equipment-<date>.xlsx` and must not trip this guard.
 */
const XLSX_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']xlsx(?:\/[^"']*)?["']/;

/**
 * SheetJS APIs that parse input. Any of these means the CVE-2023-30533 advisory
 * exemption no longer covers us.
 */
const READ_APIS = [
  "XLSX.read",
  "XLSX.readFile",
  ".readFile(",
  "readFileSync",
  "sheet_to_json",
  "sheet_to_csv",
  "sheet_to_html",
  "sheet_to_formulae",
  "table_to_book",
  "table_to_sheet",
];

function listSourceFiles(tree: string): string[] {
  const root = path.join(repoRoot, tree);
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const abs = path.join(entry.parentPath ?? entry.path, entry.name);
    out.push(path.relative(repoRoot, abs).split(path.sep).join("/"));
  }
  return out;
}

describe("xlsx (SheetJS CE) stays write-only and pinned", () => {
  it("is imported by exactly one shipped file", () => {
    const importers = SCANNED_TREES.flatMap(listSourceFiles).filter((rel) =>
      XLSX_SPECIFIER.test(readFileSync(path.join(repoRoot, rel), "utf8")),
    );
    expect(importers.sort()).toEqual([SOLE_IMPORTER]);
  });

  it("never reaches a SheetJS parse/read API", () => {
    const source = readFileSync(path.join(repoRoot, SOLE_IMPORTER), "utf8");
    const found = READ_APIS.filter((api) => source.includes(api));
    expect(found).toEqual([]);
  });

  it("is pinned to an exact version, because no upgrade will ever arrive on npm", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const spec: string = pkg.dependencies?.xlsx ?? pkg.devDependencies?.xlsx ?? "";
    // `^0.18.5` is inert today (npm's `latest` IS 0.18.5, and a caret on 0.x
    // cannot cross to 0.19.x anyway) — but it advertises an upgrade path that
    // does not exist, which is exactly the misreading this pin removes.
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
