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
 * The per-block check lives in ONE function — `validateTitledBlock` — used by
 * both the real-component suite and the regression fixtures, so the same logic
 * that green-lights the components is the logic proven to reject the failure
 * modes (missing / mis-scoped / undefined-key / unknown-alias descriptions).
 * `<AlertDialog*>` is out of scope (its own Radix primitive, already carries an
 * AlertDialogDescription).
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

type Block = { type: "Dialog" | "Sheet"; body: string };

/** Extract each <Dialog|SheetContent>…</…Content> block (not nested, not AlertDialog). */
function contentBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  for (const m of src.matchAll(/<(Dialog|Sheet)Content\b[\s\S]*?<\/\1Content>/g)) {
    blocks.push({ type: m[1] as "Dialog" | "Sheet", body: m[0] });
  }
  return blocks;
}

const isTitled = (b: Block): boolean => new RegExp(`<${b.type}Title\\b`).test(b.body);

/**
 * The single source of truth for "is this titled content block accessible?":
 * it must contain its OWN scoped Description that references an i18n accessor
 * resolving to a defined, non-empty string. Returns `.ok` + a human `.reason`.
 */
function validateTitledBlock(b: Block, aliases: Map<string, string>): { ok: boolean; reason?: string } {
  const dm = b.body.match(new RegExp(`<${b.type}Description\\b[^>]*>\\s*\\{([^}]+)\\}`));
  if (!dm) return { ok: false, reason: `titled ${b.type}Content has no scoped ${b.type}Description` };

  const expr = dm[1].trim();
  if (!/^[a-z]\w*\./i.test(expr)) return { ok: false, reason: `description is a raw string, not an i18n accessor: ${expr}` };

  const keyPath = resolveKeyPath(expr, aliases);
  if (!keyPath) return { ok: false, reason: `unresolved accessor (unknown alias?): ${expr}` };

  const value = lookup(keyPath);
  if (typeof value !== "string" || value.length === 0) return { ok: false, reason: `i18n key ${keyPath} is not a defined string` };

  return { ok: true };
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
      const titled = contentBlocks(src).filter(isTitled);

      it("has at least one titled Dialog/Sheet content block", () => {
        expect(titled.length).toBeGreaterThan(0);
      });

      it("each titled content block passes validateTitledBlock (scoped, defined-key description)", () => {
        for (const b of titled) {
          const r = validateTitledBlock(b, aliases);
          expect(r.ok, r.reason).toBe(true);
        }
      });

      it("does not silence the warning with aria-describedby={undefined}", () => {
        expect(src).not.toMatch(/aria-describedby=\{undefined\}/);
      });
    });
  }
});

// Prove the same `validateTitledBlock` used above actually REJECTS the failure
// modes — otherwise a green suite over the real components would be meaningless.
describe("validateTitledBlock — rejects bad descriptions", () => {
  const noAlias = new Map<string, string>();
  const block = (jsx: string): Block => contentBlocks(jsx)[0];

  it("missing description (titled block, no Description)", () => {
    const r = validateTitledBlock(block(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle></DialogContent>`), noAlias);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no scoped DialogDescription/);
  });

  it("mis-scoped description (placed OUTSIDE the content block)", () => {
    const src = `<DialogContent><DialogTitle>{t.a.b}</DialogTitle></DialogContent><DialogDescription className="sr-only">{t.x.y}</DialogDescription>`;
    expect(contentBlocks(src)).toHaveLength(1); // the stray Description is not part of any block
    const r = validateTitledBlock(block(src), noAlias);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no scoped DialogDescription/);
  });

  it("undefined / typo i18n key", () => {
    const r = validateTitledBlock(
      block(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle><DialogDescription>{t.dockReturn.totallyNotAKey}</DialogDescription></DialogContent>`),
      noAlias,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a defined string/);
  });

  it("raw string instead of an accessor", () => {
    const r = validateTitledBlock(
      block(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle><DialogDescription>{"just a string"}</DialogDescription></DialogContent>`),
      noAlias,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/raw string/);
  });

  it("resolves an aliased accessor to a defined key (const p = t.ns) …", () => {
    const aliases = aliasMap("const p = t.inventoryItemsPage;");
    const r = validateTitledBlock(
      block(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle><DialogDescription>{p.createDialogDescription}</DialogDescription></DialogContent>`),
      aliases,
    );
    expect(r.ok, r.reason).toBe(true);
  });

  it("… and rejects an unknown alias", () => {
    const aliases = aliasMap("const p = t.inventoryItemsPage;");
    const r = validateTitledBlock(
      block(`<DialogContent><DialogTitle>{t.a.b}</DialogTitle><DialogDescription>{q.whatever}</DialogDescription></DialogContent>`),
      aliases,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unresolved accessor/);
  });
});
