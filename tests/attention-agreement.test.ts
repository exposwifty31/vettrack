/**
 * Track C / Phase 4 — the regression guard for the reported contradiction:
 * `/home` reading 100% while `/dashboard` read 65 on the same fleet.
 *
 * The fixture is built to be exactly that fleet: nothing has a bad status, but several
 * items have not been seen inside the staleness window. The old coverage ring counted
 * `equipmentTriageTier(eq) === "attention"`, which never reads `lastSeen` — so it
 * scored this fleet as fully healthy while the dashboard flagged it.
 */
import { describe, it, expect } from "vitest";
import type { Equipment } from "@/types";
import { countNeedsAttention, STALE_THRESHOLD_MS } from "@/lib/attention";
import { equipmentTriageTier } from "@/lib/design-tokens";
import { computeDashboardData, computeDashboardCounts } from "@/lib/dashboard-utils";

const NOW = Date.now();
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - STALE_THRESHOLD_MS - 60 * 60_000).toISOString();

function eq({
  id = "e",
  name = "n",
  status = "ok",
  createdAt = FRESH,
  lastSeen = FRESH,
  ...rest
}: Partial<Equipment> = {}): Equipment {
  return { id, name, status, createdAt, lastSeen, ...rest };
}

/** Healthy statuses throughout; three of five simply have not been seen in over a day. */
const STALE_FLEET: Equipment[] = [
  eq({ id: "a", lastSeen: FRESH }),
  eq({ id: "b", lastSeen: FRESH }),
  eq({ id: "c", lastSeen: STALE }),
  eq({ id: "d", lastSeen: STALE }),
  eq({ id: "e", lastSeen: null }),
];

describe("attention count — /home and /dashboard agree", () => {
  it("the fixture really does exercise the divergence (guard against a toothless test)", () => {
    const oldRingCount = STALE_FLEET.filter((e) => equipmentTriageTier(e) === "attention").length;
    expect(oldRingCount).toBe(0); // the ring saw a perfect fleet…
    expect(countNeedsAttention(STALE_FLEET, NOW)).toBe(3); // …while three items were unseen
  });

  it("the dashboard's attention count is the canonical count, not a second opinion", () => {
    expect(computeDashboardData(STALE_FLEET).counts.needsAttention).toBe(
      countNeedsAttention(STALE_FLEET, NOW),
    );
  });

  it("a fully fresh, healthy fleet reads zero on both", () => {
    const healthy = [eq({ id: "a" }), eq({ id: "b" })];
    expect(countNeedsAttention(healthy, NOW)).toBe(0);
    expect(computeDashboardData(healthy).counts.needsAttention).toBe(0);
  });
});

/**
 * The rendered tile, not just the computed field. `/dashboard`'s attention tile used
 * to render `counts.issues + counts.missing`, which silently drops `maintenance`,
 * `critical` and `needs_attention` items — a second definition living in JSX.
 */
describe("the /dashboard attention tile renders the canonical count", () => {
  it("does not fall back to issues + missing, which misses non-issue problem statuses", () => {
    const fleet: Equipment[] = [
      eq({ id: "a", status: "maintenance", lastSeen: FRESH }),
      eq({ id: "b", status: "critical", lastSeen: FRESH }),
      eq({ id: "c", status: "ok", lastSeen: FRESH }),
    ];
    const { counts } = computeDashboardData(fleet);

    expect(counts.issues + counts.missing).toBe(0); // the old expression sees nothing…
    expect(counts.needsAttention).toBe(2); // …the canonical one sees both
  });
});

/**
 * `computeDashboardCounts` is a SECOND counts path — `computeOperationalPercent` and
 * `generate-report.ts` use it, `computeDashboardData` has its own loop. A mutation
 * planted in this one initially survived, because nothing here exercised it. Both
 * paths must answer with the canonical count or the report and the screen disagree.
 */
describe("computeDashboardCounts — the second counts path agrees too", () => {
  it("returns the canonical attention count, matching the selector", () => {
    expect(computeDashboardCounts(STALE_FLEET).needsAttention).toBe(
      countNeedsAttention(STALE_FLEET, NOW),
    );
  });

  it("counts non-issue problem statuses that issues + missing drops", () => {
    const fleet: Equipment[] = [
      eq({ id: "a", status: "maintenance", lastSeen: FRESH }),
      eq({ id: "b", status: "ok", lastSeen: FRESH }),
    ];
    const c = computeDashboardCounts(fleet);
    expect(c.issues + c.missing).toBe(0);
    expect(c.needsAttention).toBe(1);
  });
});
