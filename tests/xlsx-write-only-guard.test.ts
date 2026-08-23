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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(__dirname, "..");

const SOLE_IMPORTER = "src/lib/export-excel.ts";

/**
 * Every tree that can put code into a shipped artifact. `src` and `server` are
 * the app; `scripts` runs in CI and on ops machines; `shared` and `packages` are
 * imported by both. All four were verified xlsx-free when this guard was written,
 * so widening the scan costs nothing and closes the drift mode where a SECOND
 * importer lands somewhere unscanned and the guard still passes.
 *
 * `tests/` is the one deliberate exclusion: this very file names the read APIs in
 * `READ_APIS` below, so scanning `tests/` would make the guard fail on itself.
 * Test coupling is also not what "ships" means.
 */
const SCANNED_TREES = ["src", "server", "scripts", "shared", "packages"];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs", // scripts/ is mostly .mjs — omitting it left an 11-file blind spot.
  ".cjs",
]);

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
/**
 * SheetJS parse/read entry points, as BARE MEMBER NAMES.
 *
 * Names, not source fragments, because the check below is structural. A
 * substring scan for `"XLSX.read"` is blind to `XLSX["read"]`, to
 * `const parse = XLSX.read`, and to `const { read } = XLSX` — three spellings
 * of the same call. It is also blind in the other direction: it fires on the
 * string appearing in a comment. Matching parsed member names removes both.
 *
 * `readFileSync` is node's, not SheetJS's; it is kept as a conservative
 * belt-and-braces name because this file may not touch the filesystem either.
 *
 * DELIBERATELY NOT SCOPED to bindings that resolve to the xlsx module, and this
 * is the safer error rather than a shortcut. Binding-scoped tracking has to
 * follow aliases transitively — `const u = XLSX.utils; u.sheet_to_json(...)`
 * escapes any tracker that only watches direct `XLSX.*` access — so precision
 * here buys false negatives, which is the exact failure this guard exists to
 * prevent. Over-approximating costs a false positive: a loud, obvious failure
 * that a developer resolves in seconds. The scope stays cheap because the
 * sibling assertion pins this file as the SOLE importer of xlsx.
 */
const READ_API_NAMES = new Set([
  "read",
  "readFile",
  "readFileSync",
  "sheet_to_json",
  "sheet_to_csv",
  "sheet_to_html",
  "sheet_to_formulae",
  "table_to_book",
  "table_to_sheet",
]);

/** Every member name the file actually reaches, however it is spelled. */
function accessedMemberNames(source: string, fileName: string): Set<string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      names.add(node.name.text);                              // XLSX.read
    } else if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (ts.isStringLiteralLike(arg)) names.add(arg.text);   // XLSX["read"]
    } else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key)) names.add(key.text);          // const { read } = XLSX
      else if (ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)) {
        names.add(key.expression.text);                       // const { ["read"]: p } = XLSX
      }
    } else if (ts.isImportSpecifier(node)) {
      names.add((node.propertyName ?? node.name).text);       // import { read } from "xlsx"
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Module specifiers reached by real module syntax — parsed, never matched. */
function importsXlsx(source: string, fileName: string): boolean {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found = false;
  const lit = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : undefined);
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (lit(node.moduleSpecifier) === "xlsx") found = true;
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && lit(node.argument.literal) === "xlsx") found = true;
    } else if (ts.isCallExpression(node)) {
      const c = node.expression;
      const dynamic = c.kind === ts.SyntaxKind.ImportKeyword;
      const req = ts.isIdentifier(c) && c.text === "require";
      if ((dynamic || req) && lit(node.arguments[0]) === "xlsx") found = true;
    } else if (ts.isImportEqualsDeclaration(node)) {
      // `import X = require("xlsx")` — the require() here is an
      // ExternalModuleReference, not a CallExpression, so the branch above
      // never sees it.
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        lit(node.moduleReference.expression) === "xlsx"
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function listSourceFiles(tree: string): string[] {
  const root = path.join(repoRoot, tree);
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const abs = path.join(entry.parentPath ?? entry.path, entry.name);
    out.push(path.relative(repoRoot, abs).split(path.sep).join("/"));
  }
  return out;
}

describe("xlsx (SheetJS CE) stays write-only and pinned", () => {
  // 20s, not the 5s default: this does a synchronous readdirSync+readFileSync+
  // full-TS-parse across every file in 5 trees (src/server/scripts/shared/
  // packages). ~900ms on a quiet dev machine, but a shared CI runner under
  // load (4 parallel vitest shards + neighboring jobs) has hit 5000ms and
  // timed out — see the 2026-08-23 main-branch CI failure on an unrelated
  // PR's merge commit. Bumping the budget, not the assertion.
  it(
    "is imported by exactly one shipped file",
    () => {
      const importers = SCANNED_TREES.flatMap(listSourceFiles).filter((rel) =>
        importsXlsx(readFileSync(path.join(repoRoot, rel), "utf8"), rel),
      );
      expect(importers.sort()).toEqual([SOLE_IMPORTER]);
    },
    20_000,
  );

  it("never reaches a SheetJS parse/read API", () => {
    const source = readFileSync(path.join(repoRoot, SOLE_IMPORTER), "utf8");
    const reached = [...accessedMemberNames(source, SOLE_IMPORTER)].filter((n) =>
      READ_API_NAMES.has(n),
    );
    expect(reached.sort(), `${SOLE_IMPORTER} reaches a SheetJS read API`).toEqual([]);
  });

  it("detects xlsx when source uses TS import-equals syntax", () => {
    expect(importsXlsx('import XLSX = require("xlsx");', "probe.ts")).toBe(true);
  });

  it("ignores commented-out TS import-equals syntax", () => {
    expect(importsXlsx('// import XLSX = require("xlsx");', "probe.ts")).toBe(false);
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
