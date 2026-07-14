/**
 * Radix dialog/sheet a11y — every DialogContent/SheetContent that renders a
 * Title must ALSO render a Description scoped inside that same content element,
 * wired to a real (defined) i18n key. Otherwise Radix logs
 * `Warning: Missing \`Description\` or \`aria-describedby={undefined}\``.
 *
 * These six components previously shipped a Title with no Description. The fix
 * adds a visually-hidden (`sr-only`) Sheet/DialogDescription wired to i18n copy
 * — never `aria-describedby={undefined}`, which silences the warning instead of
 * fixing it. Source-structure assertions (readFileSync, no rendering) following
 * the precedent in tests/native-auth-surface.test.ts.
 *
 * The assertions are per-content-block (not a global per-file count) so a
 * description placed in the WRONG dialog, a titled block with NO description, or
 * a description pointing at an UNDEFINED key all fail. `<AlertDialog*>` is out of
 * scope (its own Radix primitive, already carries AlertDialogDescription).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const EN = JSON.parse(read("locales/en.json")) as Record<string, unknown>;

const lookup = (dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), EN);

/** Resolve a JSX accessor expr (`t.a.b`, or an aliased `p.b` where the file has
 *  `const p = t.inventoryItemsPage`) to a dotted en.json key path. */
function resolveKeyPath(expr: string, aliases: Map<string, string>): string | null {
  const trimmed = expr.trim();
  if (trimmed.startsWith("t.")) return trimmed.slice(2);
  const [head, ...rest] = trimmed.split(".");
  const ns = aliases.get(head);
  return ns && rest.length ? `${ns}.${rest.join(".")}` : null;
}

/** `const p = t.inventoryItemsPage;` → { p: "inventoryItemsPage" } */
function aliasMap(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, alias, ns] of src.matchAll(/const\s+(\w+)\s*=\s*t\.(\w+)\s*;/g)) m.set(alias, ns);
  return m;
}

/** Extract each <Dialog|SheetContent>…</…Content> block (not nested, not AlertDialog). */
function contentBlocks(src: string): Array<{ type: "Dialog" | "Sheet"; body: string }> {
  const blocks: Array<{ type: "Dialog" | "Sheet"; body: string }> = [];
  for (const m of src.matchAll(/<(Dialog|Sheet)Content\b[\s\S]*?<\/\1Content>/g)) {
    blocks.push({ type: m[1] as "Dialog" | "Sheet", body: m[0] });
  }
  return blocks;
}

const COMPONENTS = [
  "src/features/equipment/LocateSearch.tsx",
  "src/components/dock-return-nfc.tsx",
  "src/pages/admin/FoldersSection.tsx",
  "src/pages/admin/SupportSection.tsx",
  "src/components/report-issue-dialog.tsx",
  "src/pages/inventory-items.tsx",
] as const;

describe("dialog/sheet a11y — every titled content block carries a scoped, defined Description", () => {
  for (const path of COMPONENTS) {
    describe(path, () => {
      const src = read(path);
      const aliases = aliasMap(src);
      const blocks = contentBlocks(src);
      const titled = blocks.filter((b) => new RegExp(`<${b.type}Title\\b`).test(b.body));

      it("has at least one titled Dialog/Sheet content block", () => {
        expect(titled.length).toBeGreaterThan(0);
      });

      it("each titled content block contains its own Description, keyed to a defined translation", () => {
        for (const b of titled) {
          const descRe = new RegExp(`<${b.type}Description\\b[^>]*>\\s*\\{([^}]+)\\}`);
          const dm = b.body.match(descRe);
          // Missing / mis-scoped description → this titled block has none.
          expect(dm, `${b.type}Content is titled but has no scoped ${b.type}Description`).not.toBeNull();

          const expr = dm![1].trim();
          expect(expr, `Description must use an i18n accessor, got: ${expr}`).toMatch(/^[a-z]\w*\./i);

          const keyPath = resolveKeyPath(expr, aliases);
          expect(keyPath, `could not resolve i18n key path for: ${expr}`).not.toBeNull();
          const value = lookup(keyPath!);
          expect(typeof value, `i18n key ${keyPath} is not a defined string`).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      });

      it("has one scoped Description per titled content block (no missing, no stray extras)", () => {
        const describedTitled = titled.filter((b) => new RegExp(`<${b.type}Description\\b`).test(b.body));
        expect(describedTitled.length).toBe(titled.length);
      });

      it("does not silence the warning with aria-describedby={undefined}", () => {
        expect(src).not.toMatch(/aria-describedby=\{undefined\}/);
      });
    });
  }
});

// The suite above only proves the real components pass. These fixtures prove the
// checks actually REJECT the failure modes CodeRabbit called out — otherwise a
// green suite would be meaningless.
describe("dialog a11y checks — regression: reject bad descriptions", () => {
  it("a titled content block with no scoped Description is caught (missing)", () => {
    const [b] = contentBlocks(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle></DialogContent>`);
    expect(/<DialogTitle\b/.test(b.body)).toBe(true);
    expect(/<DialogDescription\b/.test(b.body)).toBe(false);
  });

  it("a Description placed OUTSIDE the titled content block is not credited (mis-scoped)", () => {
    const src = `<DialogContent><DialogTitle>{t.a.b}</DialogTitle></DialogContent><DialogDescription className="sr-only">{t.x.y}</DialogDescription>`;
    const [b] = contentBlocks(src);
    // Only one content block; the stray Description sits after </DialogContent>.
    expect(contentBlocks(src)).toHaveLength(1);
    expect(/<DialogDescription\b/.test(b.body)).toBe(false);
  });

  it("a Description pointing at an undefined i18n key is caught (unrelated/typo)", () => {
    expect(lookup("dockReturn.scanDockMasterTag")).toBeTypeOf("string"); // real key resolves
    expect(lookup("dockReturn.totallyNotAKey")).toBeUndefined(); // typo does not
  });

  it("resolves aliased accessors (const p = t.ns) and rejects unknown aliases", () => {
    const aliases = aliasMap("const p = t.inventoryItemsPage;");
    expect(resolveKeyPath("p.createDialogDescription", aliases)).toBe("inventoryItemsPage.createDialogDescription");
    expect(resolveKeyPath("q.whatever", aliases)).toBeNull();
  });
});
