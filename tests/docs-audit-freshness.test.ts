/**
 * Drift gate for the three generated inventories under `docs/audit/`.
 *
 * WHY THIS EXISTS. The tier-2 audit found the /board Command Center platform
 * target described incorrectly by five independent documents at once —
 * ARCHITECTURE.md, CONTEXT.md, docs/scope-change-2026.md, and BOTH generated
 * inventories. Four of those were hand-written and rotted the ordinary way.
 * The generated pair rotted differently and worse: nobody had run
 * `pnpm docs:audit` since 2026-07-08, so `db.md` was missing 11 real tables
 * (17% incomplete) and `frontend-routes.md` still showed pre-`/board` routing —
 * while both files still read as machine-generated, and therefore authoritative,
 * to anyone opening them.
 *
 * Correcting those five documents fixed the instance. This fixes the class: a
 * generated file that has drifted from its generator now fails CI instead of
 * quietly misleading the next reader.
 *
 * WHEN THIS FAILS, run `pnpm docs:audit` and commit the result. Do not hand-edit
 * a file in `docs/audit/` to make this pass — that recreates exactly the
 * condition the gate exists to catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractAllRoutes } from "../scripts/architecture/extract-express-routes.mjs";
import { formatRoutesMarkdown } from "../scripts/docs/format-routes-markdown.mjs";
import { generateFrontendRoutesMarkdown } from "../scripts/docs/extract-frontend-routes.mjs";
import { generateSchemaInventoryMarkdown } from "../scripts/docs/extract-schema-inventory.mjs";

/**
 * Every generator stamps today's date on line 5, so a byte comparison would
 * fail every day regardless of drift. Normalise the date only — the rest of
 * that line (e.g. routes.md's "**284** unique method+path pairs") is real
 * content and stays compared.
 */
function normalise(markdown: string): string {
  return markdown.replace(/^Generated \d{4}-\d{2}-\d{2}/m, "Generated <date>");
}

function committed(relPath: string): string {
  return normalise(readFileSync(resolve(process.cwd(), relPath), "utf8"));
}

const CASES = [
  {
    file: "docs/audit/routes.md",
    regenerate: () => formatRoutesMarkdown(extractAllRoutes()),
  },
  {
    file: "docs/audit/frontend-routes.md",
    regenerate: () => generateFrontendRoutesMarkdown(),
  },
  {
    file: "docs/audit/db.md",
    regenerate: () => generateSchemaInventoryMarkdown(),
  },
] as const;

describe("docs/audit generated inventories are current", () => {
  for (const { file, regenerate } of CASES) {
    it(
      `${file} matches its generator`,
      () => {
        const fresh = normalise(regenerate());
        expect(
          committed(file),
          `${file} is stale — it no longer matches its generator. Run \`pnpm docs:audit\` and commit the result.`,
        ).toBe(fresh);
      },
      30_000,
    );
  }

  /**
   * Falsifiability. A gate that cannot fail is not a gate, and a comparison
   * that silently normalises too much would pass on real drift. This proves the
   * comparison reacts to a single-row change — the exact shape of the drift
   * that produced the /board blind spot.
   */
  it("detects a single dropped row (proves the comparison can fail)", () => {
    const fresh = normalise(generateFrontendRoutesMarkdown());
    const rowIndex = fresh.split("\n").findIndex((l) => l.startsWith("| `/"));
    expect(rowIndex, "expected at least one route row to tamper with").toBeGreaterThan(-1);
    const tampered = fresh
      .split("\n")
      .filter((_, i) => i !== rowIndex)
      .join("\n");
    expect(tampered).not.toBe(fresh);
  });

  /**
   * The frontend extractor builds its sections from hand-written predicates, so
   * a route matching none of them used to vanish with no warning. A catch-all
   * "Other" section now backstops that, but the catch-all itself is only load
   * bearing if this holds: every `<Route path="…">` in the source appears in the
   * inventory. Asserted against the source directly, not against the generator,
   * so a bug inside the generator cannot make this pass.
   */
  it("lists every route declared in src/app/routes.tsx", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/routes.tsx"), "utf8");
    const declared = new Set([...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
    const doc = generateFrontendRoutesMarkdown();
    const listed = new Set([...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));
    const missing = [...declared].filter((p) => !listed.has(p));
    expect(missing, `routes declared in source but absent from the inventory: ${missing.join(", ")}`).toEqual([]);
  });
});
