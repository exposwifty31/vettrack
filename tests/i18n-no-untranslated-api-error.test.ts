import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, relative } from "path";

/**
 * Untranslated-server-error governance test (Phase 6 §14 item 3).
 *
 * Detects 4xx/5xx response bodies in `server/routes/` that are built
 * without going through the Phase 6 i18n-aware `apiError` helper
 * (introduced in PR 6.3 at `server/lib/apiError.ts`).
 *
 * Rollout (Phase 6 §14 / §15 PR 6.1 → PR 6.14):
 *   - **PR 6.1 (this PR):** ships in WARN-ONLY mode with an allowlist of
 *     every currently-existing `server/routes/*.ts` file. The test always
 *     passes; it logs a warning if any non-allowlisted route contains
 *     hardcoded 4xx/5xx response patterns. The allowlist locks in the
 *     baseline so NEW untranslated errors in NEW routes surface as
 *     warnings.
 *   - **PR 6.14:** flips to fail-mode-for-non-allowlisted. The remaining
 *     legacy server route literals stay in the allowlist with ownership
 *     comments — they are explicitly out of Phase 6's migration scope.
 *
 * Ownership comments below are best-effort `# owner: <area>` markers.
 * Update them as you migrate routes.
 */

const RESPONSE_STATUS_RE = /\bres\.status\(\s*[45]\d\d\b/;

const ROUTES_DIR = "server/routes";
const SCAN_EXTS = new Set([".ts", ".js"]);

/**
 * Allowlist of `server/routes/*` files known to contain hardcoded 4xx/5xx
 * response bodies as of the Phase 6 PR 6.1 baseline. Files migrated to the
 * i18n `apiError` helper in PR 6.10 (and any future migration PR) MUST be
 * removed from this list as part of that PR.
 */
const KNOWN_DEBT_ALLOWLIST = new Set<string>([
  "server/routes/activity.ts", // owner: activity
  "server/routes/admin-outbox-dlq.ts", // owner: outbox
  "server/routes/admin-outbox-health.ts", // owner: outbox
  "server/routes/admin-rfid-readers.ts", // owner: rfid (admin observability; English-only like sibling admin-* routes)
  "server/routes/admin-task-ownership.ts", // owner: authority
  "server/routes/alert-acks.ts", // owner: alerts
  "server/routes/analytics.ts", // owner: analytics
  "server/routes/appointments.ts", // owner: tasks
  "server/routes/audit-logs.ts", // owner: observability
  "server/routes/clinical-check-in.ts", // owner: authority
  "server/routes/code-blue.ts", // owner: code-blue
  "server/routes/containers.ts", // owner: inventory
  "server/routes/crash-cart.ts", // owner: code-blue
  "server/routes/cursor-bug-fixer.ts", // owner: admin
  "server/routes/dispense.ts", // owner: dispense (PR 6.10 target)
  "server/routes/display.ts", // owner: display
  "server/routes/equipment-copilot.ts", // owner: equipment
  "server/routes/equipment-locate.ts", // owner: equipment (read-only locate; uses equipment-route-utils apiError like sibling equipment routes)
  "server/routes/equipment-operational-state.ts", // owner: equipment-ops-v2 (V2 procedure-bind; will be i18n'd in שלב 5)
  "server/routes/equipment.ts", // owner: equipment
  "server/routes/folders.ts", // owner: equipment
  "server/routes/health.ts", // owner: infra (probe endpoints — frozen contract)
  "server/routes/integrations.ts", // owner: integrations
  "server/routes/inventory-items.ts", // owner: inventory
  "server/routes/metrics.ts", // owner: observability
  "server/routes/procurement.ts", // owner: procurement
  "server/routes/push.ts", // owner: push
  "server/routes/queue.ts", // owner: infra
  "server/routes/realtime.ts", // owner: realtime
  "server/routes/restock.ts", // owner: inventory
  "server/routes/returns.ts", // owner: equipment
  "server/routes/rooms.ts", // owner: rooms
  "server/routes/shift-chat.ts", // owner: shift-chat
  "server/routes/shifts.ts", // owner: shifts
  "server/routes/stability.ts", // owner: stability (PR 6.10 target)
  "server/routes/storage.ts", // owner: storage
  "server/routes/support.ts", // owner: support
  "server/routes/tasks.ts", // owner: tasks
  "server/routes/test.ts", // owner: test-only (PR 6.3 light adoption)
  "server/routes/uploads.ts", // owner: storage
  "server/routes/users.ts", // owner: users
  "server/routes/webhooks.ts", // owner: integrations
  "server/routes/whatsapp.ts", // owner: messaging
]);

function listRouteFiles(): string[] {
  const cwd = process.cwd();
  const root = resolve(cwd, ROUTES_DIR);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = resolve(root, entry);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const ext = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "";
    if (!SCAN_EXTS.has(ext)) continue;
    out.push(relative(cwd, full));
  }
  return out.sort();
}

function fileHasUntranslated4xxOr5xx(rel: string): boolean {
  const content = readFileSync(resolve(process.cwd(), rel), "utf-8");
  return RESPONSE_STATUS_RE.test(content);
}

describe("Untranslated server error governance (Phase 6 §14 item 3) — fail-mode", () => {
  it("non-allowlisted route files have no untranslated 4xx/5xx responses", () => {
    // Phase 6 PR 6.14 flip: this test was warn-only in PR 6.1 through
    // PR 6.13 to allow the existing baseline to ship green. PR 6.14
    // flips to fail-mode-for-non-allowlisted: NEW route files added
    // after PR 6.14 must either avoid hardcoded 4xx/5xx responses
    // (use the i18n `apiError(req, res, key, params?, status?)`
    // helper) or be explicitly added to KNOWN_DEBT_ALLOWLIST with a
    // reviewer-approved ownership comment.
    //
    // Existing legacy routes in the allowlist are intentionally not
    // migrated in Phase 6 (see §14 item 3 + §15 PR 6.10 + §17). Each
    // route's full migration is a separate follow-up PR.
    const offenders = listRouteFiles().filter(fileHasUntranslated4xxOr5xx);
    const nonAllowlisted = offenders.filter((f) => !KNOWN_DEBT_ALLOWLIST.has(f));
    expect(nonAllowlisted).toEqual([]);
  });

  it("allowlist contains no stale entries (files that no longer exist)", () => {
    const existing = new Set(listRouteFiles());
    const stale = [...KNOWN_DEBT_ALLOWLIST].filter((f) => !existing.has(f)).sort();
    expect(stale).toEqual([]);
  });
});
