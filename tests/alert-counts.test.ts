import { describe, expect, it } from "vitest";
import type { Alert } from "@/types";
import {
  buildAlertAckSet,
  countActiveAlerts,
  countCriticalAlerts,
  isUrgentAlert,
} from "@/lib/alert-counts";

const sampleAlerts: Alert[] = [
  {
    type: "issue",
    severity: "critical",
    equipmentId: "eq-1",
    equipmentName: "Pump",
    detail: "Issue",
  },
  {
    type: "overdue",
    severity: "high",
    equipmentId: "eq-2",
    equipmentName: "Monitor",
    detail: "Overdue",
  },
  {
    type: "inactive",
    severity: "low",
    equipmentId: "eq-3",
    equipmentName: "Cart",
    detail: "Inactive",
  },
];

describe("alert-counts", () => {
  it("filters acknowledged alerts from active counts", () => {
    const acks = buildAlertAckSet([
      {
        id: "ack-1",
        equipmentId: "eq-1",
        alertType: "issue",
        acknowledgedByUserId: "u1",
        acknowledgedByEmail: "a@b.com",
        acknowledgedAt: new Date().toISOString(),
      },
    ]);
    expect(countActiveAlerts(sampleAlerts, acks)).toBe(2);
    expect(countCriticalAlerts(sampleAlerts, acks)).toBe(0);
  });

  it("identifies urgent alert types", () => {
    expect(sampleAlerts.filter(isUrgentAlert).map((a) => a.type)).toEqual(["issue", "overdue"]);
  });
});
