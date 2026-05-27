import { describe, expect, it } from "vitest";
import {
  buildReturnReminderPushBody,
  resolveReturnReminderMessageKey,
} from "../server/lib/role-notification-scheduler.js";

describe("return reminder copy (WTL-UX-02b)", () => {
  it("uses default key when no waiters", () => {
    expect(resolveReturnReminderMessageKey(0)).toBe("push.role.reminderForEquipment");
  });

  it("uses waitlist key when queue has waiting users", () => {
    expect(resolveReturnReminderMessageKey(1)).toBe("push.role.reminderForEquipmentWithWaitlist");
  });

  it("builds different body when waitlist exists vs empty queue", async () => {
    const withWaitlist = await buildReturnReminderPushBody("user-1", "BP Monitor", 2);
    const withoutWaitlist = await buildReturnReminderPushBody("user-1", "BP Monitor", 0);
    expect(withWaitlist).toContain("BP Monitor");
    expect(withoutWaitlist).toContain("BP Monitor");
    expect(withWaitlist).not.toBe(withoutWaitlist);
  });
});
