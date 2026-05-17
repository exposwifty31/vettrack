/**
 * Phase 6 PR 6.5 — sync banner / queue-sheet locale coverage.
 *
 * Asserts that the four enumerated literals migrated by PR 6.5
 *   - `Syncing`             → `t.sync.status.syncing`
 *   - `Retry`               → `t.sync.action.retry`
 *   - `pending sync`        → `t.sync.status.pending(count)` (plural)
 *   - `failed to sync`      → `t.sync.status.failed(count)`  (plural)
 * resolve to the expected English and Hebrew strings, including the
 * `one` / `other` plural branches.
 *
 * Vitest runs in `node` (no DOM), so this exercises the accessor +
 * interpolator path directly rather than rendering the components.
 * The components consume the same accessor results, so the assertion
 * is equivalent to a render-and-grep at this granularity.
 */

import { describe, it, expect } from "vitest";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { interpolate } from "../lib/i18n/index";

describe("Phase 6 PR 6.5 — sync.* keys resolve to expected English copy", () => {
  it("status.syncing → 'Syncing…'", () => {
    expect(enDict.sync.status.syncing).toBe("Syncing…");
  });

  it("action.retry → 'Retry'", () => {
    expect(enDict.sync.action.retry).toBe("Retry");
  });

  it("status.pending uses singular branch for count=1 (with ICU `#` substituted)", () => {
    expect(interpolate(enDict.sync.status.pending, { count: 1 })).toBe("1 item pending sync");
  });

  it("status.pending uses plural branch for count=5 (with ICU `#` substituted)", () => {
    expect(interpolate(enDict.sync.status.pending, { count: 5 })).toBe("5 items pending sync");
  });

  it("status.failed uses singular branch for count=1 (with ICU `#` substituted)", () => {
    expect(interpolate(enDict.sync.status.failed, { count: 1 })).toBe("1 item failed to sync");
  });

  it("status.failed uses plural branch for count=3 (with ICU `#` substituted)", () => {
    expect(interpolate(enDict.sync.status.failed, { count: 3 })).toBe("3 items failed to sync");
  });
});

describe("Phase 6 PR 6.5 — sync.* keys resolve to expected Hebrew copy", () => {
  it("status.syncing → 'מסנכרן…'", () => {
    expect(heDict.sync.status.syncing).toBe("מסנכרן…");
  });

  it("action.retry → 'נסה שוב'", () => {
    expect(heDict.sync.action.retry).toBe("נסה שוב");
  });

  it("status.pending uses singular branch for count=1 (with ICU `#` substituted)", () => {
    expect(interpolate(heDict.sync.status.pending, { count: 1 })).toBe("1 פריט בהמתנה לסנכרון");
  });

  it("status.pending uses plural branch for count=5 (with ICU `#` substituted)", () => {
    expect(interpolate(heDict.sync.status.pending, { count: 5 })).toBe("5 פריטים בהמתנה לסנכרון");
  });

  it("status.failed uses singular branch for count=1 (with ICU `#` substituted)", () => {
    expect(interpolate(heDict.sync.status.failed, { count: 1 })).toBe("1 פריט נכשל בסנכרון");
  });

  it("status.failed uses plural branch for count=3 (with ICU `#` substituted)", () => {
    expect(interpolate(heDict.sync.status.failed, { count: 3 })).toBe("3 פריטים נכשלו בסנכרון");
  });
});

describe("Phase 6 PR 6.5 — sync banner + sync queue sheet have no English sync literals", () => {
  it("sync-status-banner.tsx does not contain 'Syncing' or 'Retry' or 'pending sync' or 'failed to sync'", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/sync-status-banner.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/"Syncing"/);
    expect(source).not.toMatch(/"Retry"/);
    expect(source).not.toMatch(/" failed to sync"/);
    expect(source).not.toMatch(/" pending sync"/);
  });

  it("sync-queue-sheet.tsx does not contain `>Retry<` text node", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/sync-queue-sheet.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/>\s*Retry\s*</);
  });
});
