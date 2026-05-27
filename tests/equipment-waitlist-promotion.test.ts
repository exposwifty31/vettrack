import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EquipmentWaitlistRow } from "../server/schema/equipment.js";
import { EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES } from "../shared/equipment-waitlist.js";

const localeRows = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => localeRows()),
    })),
  },
  equipment: { name: "name", id: "id", clinicId: "clinicId" },
  users: { preferredLocale: "preferredLocale", id: "id", clinicId: "clinicId" },
}));

const {
  equipmentWaitlistPromotionDeps,
  notifyWaitlistPromoted,
  promoteEquipmentWaitlistWithNotify,
} = await import("../server/lib/equipment-waitlist-promotion.js");

function makePromotedRow(overrides: Partial<EquipmentWaitlistRow> = {}): EquipmentWaitlistRow {
  return {
    id: "wl-row-1",
    clinicId: "clinic-1",
    equipmentId: "eq-1",
    userId: "user-b",
    status: "notified",
    priority: 0,
    joinedAt: new Date("2026-05-27T10:00:00.000Z"),
    notifiedAt: new Date("2026-05-27T12:00:00.000Z"),
    reservationExpiresAt: new Date("2026-05-27T12:10:00.000Z"),
    fulfilledAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T12:00:00.000Z"),
    ...overrides,
  };
}

describe("notifyWaitlistPromoted", () => {
  const enqueueNotificationJob = vi.fn().mockResolvedValue(undefined);
  const getEquipmentName = vi.fn().mockResolvedValue("Ventilator");

  beforeEach(() => {
    vi.clearAllMocks();
    localeRows.mockResolvedValue([{ preferredLocale: "en" }]);
    equipmentWaitlistPromotionDeps.enqueueNotificationJob = enqueueNotificationJob;
    equipmentWaitlistPromotionDeps.getEquipmentName = getEquipmentName;
  });

  it("enqueues HIGH priority push with reservation TTL and stable idempotency key", async () => {
    const promoted = makePromotedRow();

    await notifyWaitlistPromoted("clinic-1", "eq-1", promoted);

    expect(getEquipmentName).toHaveBeenCalledWith("eq-1", "clinic-1");
    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    const job = enqueueNotificationJob.mock.calls[0]?.[0];
    expect(job).toMatchObject({
      type: "push_to_user",
      clinicId: "clinic-1",
      userId: "user-b",
      priority: "HIGH",
      tag: "waitlist-promoted:eq-1",
      url: "/equipment/eq-1",
      idempotencyKey: "waitlist-promoted:wl-row-1",
    });
    expect(job.body).toContain("Ventilator");
    expect(job.body).toContain(String(EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES));
  });

  it("uses Hebrew locale copy when recipient prefers he", async () => {
    localeRows.mockResolvedValue([{ preferredLocale: "he" }]);
    const promoted = makePromotedRow();

    await notifyWaitlistPromoted("clinic-1", "eq-1", promoted);

    const job = enqueueNotificationJob.mock.calls[0]?.[0];
    expect(job.title).toBeTruthy();
    expect(job.body).toContain("Ventilator");
  });

  it("swallows notification errors without throwing", async () => {
    enqueueNotificationJob.mockRejectedValueOnce(new Error("queue down"));
    const promoted = makePromotedRow();

    await expect(notifyWaitlistPromoted("clinic-1", "eq-1", promoted)).resolves.toBeUndefined();
  });
});

describe("promoteEquipmentWaitlistWithNotify", () => {
  const promoteIfEligible = vi.fn();
  const enqueueNotificationJob = vi.fn().mockResolvedValue(undefined);
  const getEquipmentName = vi.fn().mockResolvedValue("BP Monitor");

  beforeEach(() => {
    vi.clearAllMocks();
    localeRows.mockResolvedValue([{ preferredLocale: "en" }]);
    equipmentWaitlistPromotionDeps.promoteIfEligible = promoteIfEligible;
    equipmentWaitlistPromotionDeps.enqueueNotificationJob = enqueueNotificationJob;
    equipmentWaitlistPromotionDeps.getEquipmentName = getEquipmentName;
  });

  it("notifies only when promotion returns a row", async () => {
    promoteIfEligible.mockResolvedValueOnce(makePromotedRow());

    await promoteEquipmentWaitlistWithNotify("clinic-1", "eq-1", "return");

    expect(promoteIfEligible).toHaveBeenCalledWith("clinic-1", "eq-1", "return");
    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
  });

  it("skips notify when no eligible waiter exists", async () => {
    promoteIfEligible.mockResolvedValueOnce(null);

    await promoteEquipmentWaitlistWithNotify("clinic-1", "eq-1", "dock_return");

    expect(enqueueNotificationJob).not.toHaveBeenCalled();
  });

  it("swallows promotion errors without throwing", async () => {
    promoteIfEligible.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      promoteEquipmentWaitlistWithNotify("clinic-1", "eq-1", "ttl_expiry"),
    ).resolves.toBeUndefined();
  });
});
