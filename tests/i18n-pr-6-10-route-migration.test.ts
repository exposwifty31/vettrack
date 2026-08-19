/**
 * Phase 6 PR 6.10 CORRECTION 2 — representative migration coverage for
 * remaining migrated server routes (dispense.ts).
 *
 * er-admin.ts and formulary.ts were removed with their admin surfaces.
 *
 * stability.ts was removed in the tier-2 audit remediation (docs/audit/
 * route-consumer-triage.md §C.1): the /stability page had already been
 * reduced to a redirect stub in src/app/routes.tsx, so the whole
 * /api/stability family had no consumer. The blocks that lived here — a
 * static i18nApiError assertion and a two-case en/he integration test
 * dispatched through the real router, plus the test-runner and
 * stability-log module mocks they needed — went with it. What they
 * covered (that a migrated route renders its 403 body per x-locale) is
 * still covered for dispense.ts by the static assertions below and, for
 * the rendering path itself, by tests/i18n-*.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Phase 6 PR 6.10 CORRECTION 2 — static coverage for migrated routes", () => {
  const dispense = readFileSync(resolve(process.cwd(), "server/routes/dispense.ts"), "utf-8");

  it("dispense.ts imports + uses i18nApiError with errors.dispense.* key (sendError catch-all)", () => {
    expect(dispense).toMatch(/apiError as i18nApiError/);
    expect(dispense).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.dispense\.internalError"/);
  });

  it("dispense.ts sendError signature now accepts req for locale plumbing", () => {
    expect(dispense).toMatch(/function\s+sendError\(\s*req:\s*Request,\s*res:\s*Response/);
  });
});
