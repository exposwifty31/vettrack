/**
 * Radix dialog/sheet a11y — every DialogContent/SheetContent that renders a
 * Title must also render a Description (or Radix logs
 * `Warning: Missing \`Description\` or \`aria-describedby={undefined}\``).
 *
 * These six components previously shipped a Title with no Description. The fix
 * adds a visually-hidden (`sr-only`) Sheet/DialogDescription wired to i18n copy
 * — never `aria-describedby={undefined}`, which silences the warning instead of
 * fixing it. Source-structure assertions (readFileSync, no rendering) following
 * the precedent in tests/native-auth-surface.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

/** Matches an opening <SheetDescription/<DialogDescription and captures the
 *  first `{...}` expression inside it. Deliberately excludes
 *  `<AlertDialogDescription` (the `<` must sit immediately before Sheet/Dialog). */
const DESCRIPTION_RE = /<(?:Sheet|Dialog)Description\b[^>]*>\s*\{([^}]+)\}/g;

const COMPONENTS: ReadonlyArray<{ path: string; minCount: number }> = [
  { path: "src/features/equipment/LocateSearch.tsx", minCount: 1 },
  { path: "src/components/dock-return-nfc.tsx", minCount: 2 },
  { path: "src/pages/admin/FoldersSection.tsx", minCount: 1 },
  { path: "src/pages/admin/SupportSection.tsx", minCount: 1 },
  { path: "src/components/report-issue-dialog.tsx", minCount: 1 },
  { path: "src/pages/inventory-items.tsx", minCount: 1 },
];

describe("dialog/sheet a11y — every titled dialog carries a Description", () => {
  for (const { path, minCount } of COMPONENTS) {
    describe(path, () => {
      const src = read(path);
      const matches = [...src.matchAll(DESCRIPTION_RE)];

      it(`renders at least ${minCount} Sheet/DialogDescription block(s)`, () => {
        expect(matches.length).toBeGreaterThanOrEqual(minCount);
      });

      it("wires every Description to an i18n accessor (t./p.), not a raw string", () => {
        expect(matches.length).toBeGreaterThan(0);
        for (const m of matches) {
          const expr = m[1].trim();
          expect(expr).toMatch(/^[tp]\./);
        }
      });

      it("does not silence the warning with aria-describedby={undefined}", () => {
        expect(src).not.toMatch(/aria-describedby=\{undefined\}/);
      });
    });
  }
});
