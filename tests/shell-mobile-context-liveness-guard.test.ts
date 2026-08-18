/**
 * Liveness guard for `src/shell/mobile/MobileShellContext.ts`.
 *
 * Why this exists: an earlier relevance audit described the whole `src/shell`
 * directory as "a thin legacy re-export alias" and recommended deleting it.
 * Four production pages import `@/shell/mobile/MobileShellContext` today, so a
 * wholesale delete would ship a broken build. Of the five files under
 * `src/shell/mobile/`, exactly one is load-bearing — and the rule protecting it
 * has so far lived only as free text in a task prompt, which has to be read and
 * honoured by hand on every future sweep. This test converts that free-text
 * exclusion into a CI assertion.
 *
 * It covers two distinct failure modes:
 *
 *   1. DELETION — the file is removed while importers remain. Loud, immediate.
 *   2. DRIFT — importers migrate away one at a time until the file is dead but
 *      still present (or, inversely, a new page quietly takes a dependency on
 *      the legacy alias instead of the canonical path). Slow, silent, and not
 *      caught by anything else in the suite.
 *
 * This guard does NOT freeze the legacy alias in place forever. Migrating a
 * page to the canonical `@/native/NativeShellContext` is allowed — it just has
 * to update PRODUCTION_IMPORTERS in the same commit, which is precisely the
 * deliberate act the guard is asking for. Once that set is empty the existence
 * assertion no longer applies and the file is genuinely removable.
 *
 * Scope note: only `src/` is scanned. `tests/` also references the specifier
 * (one direct import in tests/mobile-shell.test.tsx, five `vi.mock` calls), but
 * test coupling is not what "live in production" means, and churn in the test
 * surface should not fail this guard.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";

const TARGET = "src/shell/mobile/MobileShellContext.ts";

const CANONICAL = "src/native/NativeShellContext.ts";

const SPECIFIER = "@/shell/mobile/MobileShellContext";

/**
 * The production importers on record. Verified by grep at the time of writing.
 * Changing this list is allowed; changing it SILENTLY is what the guard blocks.
 */
const PRODUCTION_IMPORTERS = [
  "src/pages/alerts.tsx",
  "src/pages/equipment-detail.tsx",
  "src/pages/equipment-list.tsx",
  "src/pages/scan.tsx",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    // `parentPath` is already repo-relative because `root` is.
    out.push(path.join(entry.parentPath, entry.name).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Module specifiers reached by real module syntax — `import`/`export ... from`,
 * `import()`, `require()`, `vi.mock()`/`jest.mock()`.
 *
 * Parsed rather than matched. A regex over source text cannot tell a module
 * position from the same words inside a comment or a string literal, so it
 * answers "does this file MENTION the specifier" while claiming to answer "does
 * this file IMPORT it" — and a guard that cannot fail on its own subject is
 * worse than no guard, because it is counted as coverage.
 */
function moduleSpecifiersOf(source: string, fileName: string): Set<string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const literal = (n: ts.Node | undefined) =>
    n && ts.isStringLiteralLike(n) ? n.text : undefined;

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) {
      const spec = literal(node.moduleSpecifier);
      if (spec) found.add(spec);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const isMock =
        ts.isPropertyAccessExpression(callee) && callee.name.text === "mock";
      if (isDynamicImport || isRequire || isMock) {
        const spec = literal(node.arguments[0]);
        if (spec) found.add(spec);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function importsSpecifier(source: string, fileName: string): boolean {
  return moduleSpecifiersOf(source, fileName).has(SPECIFIER);
}

function currentProductionImporters(): string[] {
  return listSourceFiles("src")
    .filter((file) => file !== TARGET)
    .filter((file) => importsSpecifier(readFileSync(file, "utf8"), file))
    .sort();
}

describe("src/shell/mobile/MobileShellContext.ts liveness guard", () => {
  it("is not deleted while production code still imports it", () => {
    const importers = currentProductionImporters();
    if (importers.length === 0) return; // Genuinely dead — deletion is now legitimate.

    expect(
      existsSync(TARGET),
      `${TARGET} is missing, but ${importers.length} production file(s) still import ` +
        `"${SPECIFIER}":\n  ${importers.join("\n  ")}\n` +
        `Deleting it breaks the build. It may only be removed once that list is empty ` +
        `(migrate each page to "@/native/NativeShellContext" first).`,
    ).toBe(true);
  });

  it("keeps exactly the production importers on record — no silent drift", () => {
    const expected = [...PRODUCTION_IMPORTERS].sort();
    const actual = currentProductionImporters();

    expect(
      actual,
      `The set of production files importing "${SPECIFIER}" changed.\n` +
        `  expected: ${JSON.stringify(expected)}\n` +
        `  actual:   ${JSON.stringify(actual)}\n` +
        `If a page was deliberately migrated to "@/native/NativeShellContext", update ` +
        `PRODUCTION_IMPORTERS in this test in the same commit. If a NEW page reached for ` +
        `the legacy "@/shell/*" alias, point it at "@/native/*" instead — that alias is ` +
        `residue being retired, not a target. This assertion exists because importers ` +
        `drifting away one at a time leaves the file dead but still present, and nothing ` +
        `else in the suite notices.`,
    ).toEqual(expected);
  });

  it("still re-exports the canonical symbols rather than being gutted in place", () => {
    if (!existsSync(TARGET)) return; // Covered by the deletion assertion above.
    expect(existsSync(CANONICAL), `${CANONICAL} is the canonical implementation`).toBe(true);

    // Parsed, not string-matched: a module gutted to a comment mentioning these
    // names would satisfy a `toContain` check while exporting nothing.
    const source = readFileSync(TARGET, "utf8");
    const sf = ts.createSourceFile(TARGET, source, ts.ScriptTarget.Latest, true);
    const reExports = new Map<string, string>(); // exported name -> source module

    sf.forEachChild((node) => {
      if (!ts.isExportDeclaration(node)) return;
      const from =
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      if (!from || !node.exportClause || !ts.isNamedExports(node.exportClause)) return;
      for (const el of node.exportClause.elements) {
        reExports.set(el.name.text, `${el.propertyName?.text ?? el.name.text}@${from}`);
      }
    });

    expect(
      reExports.get("useMobileShellContext"),
      `${TARGET} must re-export useNativeShellContext from the canonical module`,
    ).toBe("useNativeShellContext@@/native/NativeShellContext");
    expect(
      reExports.get("MobileShellContext"),
      `${TARGET} must re-export NativeShellContext from the canonical module`,
    ).toBe("NativeShellContext@@/native/NativeShellContext");
  });
});
