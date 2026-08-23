import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeBundleReadinessGate,
} from "../server/services/equipment-operational-state.service.js";
import type { AssetTypeCondition, UnitConditionState } from "../server/db.js";

const NOW = new Date("2026-01-01T12:00:00Z");

function makeCondition(overrides: Partial<AssetTypeCondition> = {}): AssetTypeCondition {
  return {
    id: "cond-1",
    clinicId: "clinic-1",
    assetTypeId: "at-1",
    conditionName: "Battery check",
    verificationMethod: "visual",
    staleAfterMinutes: 60,
    displayOrder: 0,
    createdAt: NOW,
    ...overrides,
  };
}

function makeState(overrides: Partial<UnitConditionState> = {}): UnitConditionState {
  return {
    id: "state-1",
    clinicId: "clinic-1",
    equipmentId: "eq-1",
    conditionId: "cond-1",
    verified: true,
    verifiedAt: new Date(NOW.getTime() - 10 * 60 * 1000), // 10 min ago — fresh
    verifiedById: null,
    notes: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("computeBundleReadinessGate", () => {
  it("returns CUSTODY_CHAIN_BROKEN with unknownConditions for untracked", () => {
    const cond = makeCondition();
    const result = computeBundleReadinessGate(
      { custodyState: "untracked", assetTypeId: "at-1" },
      [],
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CUSTODY_CHAIN_BROKEN",
      unknownConditions: ["Battery check"],
      failedConditions: [],
      staleConditions: [],
    });
  });

  it("returns CONDITIONS_NOT_MET with unknownConditions for returned", () => {
    const cond = makeCondition();
    const result = computeBundleReadinessGate(
      { custodyState: "returned", assetTypeId: "at-1" },
      [],
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      unknownConditions: ["Battery check"],
    });
  });

  it("returns CONDITIONS_NOT_MET with unknownConditions for checked_out", () => {
    const cond = makeCondition();
    const result = computeBundleReadinessGate(
      { custodyState: "checked_out", assetTypeId: "at-1" },
      [],
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      unknownConditions: ["Battery check"],
    });
  });

  it("returns NO_ASSET_TYPE_DEFINED when assetTypeId is null", () => {
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: null },
      [],
      [],
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      reason: "NO_ASSET_TYPE_DEFINED",
      failedConditions: [],
      staleConditions: [],
      unknownConditions: [],
    });
  });

  it("returns NO_CONDITIONS_DEFINED when conditions array is empty", () => {
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1" },
      [],
      [],
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      reason: "NO_CONDITIONS_DEFINED",
      failedConditions: [],
      staleConditions: [],
      unknownConditions: [],
    });
  });

  it("adds to unknownConditions when condition has no state record", () => {
    const cond = makeCondition({ id: "cond-x", conditionName: "Pressure check" });
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1" },
      [], // no states
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      unknownConditions: ["Pressure check"],
      failedConditions: [],
      staleConditions: [],
    });
  });

  it("adds to failedConditions when state verified=false", () => {
    const cond = makeCondition();
    const state = makeState({ verified: false, verifiedAt: null });
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1" },
      [state],
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      failedConditions: ["Battery check"],
      staleConditions: [],
      unknownConditions: [],
    });
  });

  it("adds to staleConditions when verifiedAt is past staleAfterMinutes", () => {
    const cond = makeCondition({ staleAfterMinutes: 30 });
    // verified 60 min ago — stale (threshold is 30 min)
    const state = makeState({ verifiedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1" },
      [state],
      [cond],
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      staleConditions: ["Battery check"],
      failedConditions: [],
      unknownConditions: [],
    });
  });

  it("returns ok:true when all conditions verified and fresh", () => {
    const cond = makeCondition({ staleAfterMinutes: 60 });
    const state = makeState({ verifiedAt: new Date(NOW.getTime() - 10 * 60 * 1000) }); // 10 min ago
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1" },
      [state],
      [cond],
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });
});

// ─── promoteStagingQueueNext ────────────────────────────────────────────────
//
// Tests operate on stagingPromotionDeps directly — no Drizzle chain to mock.

import {
  promoteStagingQueueNext,
  stagingPromotionDeps,
} from "../server/lib/staging-promotion.js";

describe("promoteStagingQueueNext", () => {
  const origDeps = { ...stagingPromotionDeps };

  beforeEach(() => {
    stagingPromotionDeps.findNextClaim = vi.fn();
    stagingPromotionDeps.getEquipmentName = vi.fn();
    stagingPromotionDeps.resolveLocale = vi.fn().mockResolvedValue("he");
    stagingPromotionDeps.enqueueNotificationJob = vi.fn();
  });

  afterEach(() => {
    Object.assign(stagingPromotionDeps, origDeps);
  });

  it("does not enqueue when no active claim exists", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue(null);
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).not.toHaveBeenCalled();
  });

  it("enqueues NORMAL priority for routine claim", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-1",
      requestedById: "user-1",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Ventilator A");
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "NORMAL",
        tag: "staging-promoted:eq-1",
        userId: "user-1",
      }),
    );
  });

  it("enqueues HIGH priority for urgent claim", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-2",
      requestedById: "user-2",
      clinicalPriority: "urgent",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Defibrillator");
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "HIGH" }),
    );
  });

  it("enqueues CRITICAL priority for emergency claim", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-3",
      requestedById: "user-3",
      clinicalPriority: "emergency",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Crash Cart");
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "CRITICAL" }),
    );
  });

  it("uses claim id (not time-based) for idempotencyKey", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-abc",
      requestedById: "user-4",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Pump");
    await promoteStagingQueueNext("eq-2", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "staging-promoted:claim-abc" }),
    );
  });

  it("does not throw when enqueueNotificationJob throws", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-x",
      requestedById: "user-5",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Device");
    vi.mocked(stagingPromotionDeps.enqueueNotificationJob).mockRejectedValue(
      new Error("Redis down"),
    );
    await expect(promoteStagingQueueNext("eq-1", "clinic-1")).resolves.toBeUndefined();
  });

  it("does not throw when findNextClaim throws", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockRejectedValue(
      new Error("DB error"),
    );
    await expect(promoteStagingQueueNext("eq-1", "clinic-1")).resolves.toBeUndefined();
  });

  it("localizes the push to the recipient's preferred locale, not a hardcoded language", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-en",
      requestedById: "user-en",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Infusion Pump A");
    vi.mocked(stagingPromotionDeps.resolveLocale).mockResolvedValue("en");
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "You are now #1 in queue",
        body: "Checkout available for Infusion Pump A",
      }),
    );
  });

  it("defaults to Hebrew copy when the recipient's locale resolves to he", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-he",
      requestedById: "user-he",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("משאבת עירוי");
    vi.mocked(stagingPromotionDeps.resolveLocale).mockResolvedValue("he");
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "אתה ראשון בתור",
        body: "ניתן לבצע checkout של משאבת עירוי",
      }),
    );
  });

  it("still sends the notification (defaulting to Hebrew) when locale lookup rejects", async () => {
    vi.mocked(stagingPromotionDeps.findNextClaim).mockResolvedValue({
      id: "claim-locale-fail",
      requestedById: "user-x",
      clinicalPriority: "routine",
    });
    vi.mocked(stagingPromotionDeps.getEquipmentName).mockResolvedValue("Ventilator B");
    vi.mocked(stagingPromotionDeps.resolveLocale).mockRejectedValue(new Error("connection reset"));
    await promoteStagingQueueNext("eq-1", "clinic-1");
    expect(stagingPromotionDeps.enqueueNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "אתה ראשון בתור",
        body: "ניתן לבצע checkout של Ventilator B",
      }),
    );
  });
});
