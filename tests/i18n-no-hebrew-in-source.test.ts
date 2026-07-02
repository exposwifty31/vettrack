import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, relative } from "path";

/**
 * Banned-Hebrew-in-source governance test (Phase 6 §5 invariant 1).
 *
 * Production source files (under `src/`, `server/`, `lib/`, `shared/`) MUST
 * NOT contain Hebrew glyphs. User-facing copy belongs in `locales/`.
 *
 * Scope:
 *   - SCANNED:    src/, server/, lib/, shared/  (extensions: .ts .tsx .js .jsx)
 *   - PERMANENTLY EXCLUDED: tests/, locales/, desktop/, migrations/,
 *                           scripts/, attached_assets/
 *     The full `tests/` tree is excluded so Hebrew test fixtures, snapshots,
 *     and assertions are not rule violations.
 *
 * `KNOWN_DEBT_ALLOWLIST` is the shrinking ledger of currently-non-compliant
 * production files awaiting their extraction PR (per Phase 6 §15 PRs
 * 6.5–6.10 + 6.11). Each extraction PR removes its files from this list.
 *
 * If you are touching a file in the allowlist and have extracted its
 * literals to `locales/`, remove the file from the list — adding to the
 * list requires explicit reviewer approval.
 */

const HEBREW_RE = /[֐-׿]/;

const SCAN_ROOTS = ["src", "server", "lib", "shared"] as const;
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const KNOWN_DEBT_ALLOWLIST = new Set<string>([
  "server/lib/role-notification-scheduler.ts",
  "server/routes/activity.ts",
  "server/routes/alert-acks.ts",
  "server/routes/code-blue.ts",
  "server/routes/crash-cart.ts",
  "server/routes/folders.ts",
  "server/routes/shift-chat.ts",
  "server/routes/shifts.ts",
  "server/routes/support.ts",
  "server/lib/staging-promotion.ts",
  "server/workers/chargeAlertWorker.ts",
  "server/workers/notification.worker.ts",
  "shared/doctor-operational-shift.ts",
  "src/components/sw-update-banner.tsx",
  "src/features/containers/components/DispenseSheet.tsx",
  "src/pages/new-equipment.tsx",
  "src/pages/not-found.tsx",
  "src/pages/qr-print.tsx",
  "src/pages/rooms-list.tsx",
  "src/pages/signin.tsx",
  "src/pages/signup.tsx",
]);

function walk(dir: string, root: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, root, acc);
      continue;
    }
    const ext = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "";
    if (!SCAN_EXTS.has(ext)) continue;
    acc.push(relative(root, full));
  }
}

function findHebrewOffenders(): string[] {
  const cwd = process.cwd();
  const offenders: string[] = [];
  for (const subdir of SCAN_ROOTS) {
    const root = resolve(cwd, subdir);
    const files: string[] = [];
    walk(root, cwd, files);
    for (const rel of files) {
      const content = readFileSync(resolve(cwd, rel), "utf-8");
      if (HEBREW_RE.test(content)) offenders.push(rel);
    }
  }
  return offenders.sort();
}

describe("No Hebrew glyphs in production source (Phase 6 §5 invariant 1)", () => {
  const offenders = findHebrewOffenders();

  it("every offender is on the known-debt allowlist (or the allowlist has shrunk)", () => {
    const newOffenders = offenders.filter((f) => !KNOWN_DEBT_ALLOWLIST.has(f));
    expect(newOffenders).toEqual([]);
  });

  it("allowlist contains no stale entries (files that no longer contain Hebrew)", () => {
    const stale = [...KNOWN_DEBT_ALLOWLIST].filter((f) => !offenders.includes(f)).sort();
    expect(stale).toEqual([]);
  });
});
