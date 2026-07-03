import { describe, it, expect } from "vitest";
import { aggregateAlerts, tierForAlert, formatBadgeCount } from "@/lib/attention";
import type { Alert } from "@/types";

function mk(type: Alert["type"], severity: string, id: string): Alert {
  return { type, severity, equipmentId: id, equipmentName: id, detail: "" } as Alert;
}

describe("attention — the shared taxonomy", () => {
  describe("formatBadgeCount caps the alarm count", () => {
    it("passes 0–9 through unchanged", () => {
      expect(formatBadgeCount(0)).toBe("0");
      expect(formatBadgeCount(9)).toBe("9");
    });
    it("caps anything above 9 at 9+ (so 60 never manufactures urgency)", () => {
      expect(formatBadgeCount(10)).toBe("9+");
      expect(formatBadgeCount(60)).toBe("9+");
    });
  });

  describe("tierForAlert", () => {
    it("critical severity wins", () => {
      expect(tierForAlert(mk("issue", "critical", "a"))).toBe("critical");
    });
    it("issue/overdue (non-critical) are urgent", () => {
      expect(tierForAlert(mk("overdue", "high", "a"))).toBe("urgent");
    });
    it("sterilization/inactive are maintenance", () => {
      expect(tierForAlert(mk("inactive", "low", "a"))).toBe("maintenance");
      expect(tierForAlert(mk("sterilization_due", "medium", "a"))).toBe("maintenance");
    });
  });

  describe("aggregateAlerts", () => {
    it("collapses per-equipment alerts into one group per type with a count", () => {
      const groups = aggregateAlerts([
        mk("inactive", "low", "1"),
        mk("inactive", "low", "2"),
        mk("inactive", "low", "3"),
        mk("overdue", "high", "4"),
      ]);
      expect(groups.find((g) => g.type === "inactive")?.count).toBe(3);
      expect(groups.find((g) => g.type === "overdue")?.count).toBe(1);
    });

    it("sorts urgent above maintenance regardless of group size", () => {
      const groups = aggregateAlerts([
        mk("inactive", "low", "1"),
        mk("inactive", "low", "2"),
        mk("inactive", "low", "3"),
        mk("overdue", "high", "4"),
      ]);
      // overdue (urgent, count 1) must rank above inactive (maintenance, count 3)
      expect(groups[0]!.type).toBe("overdue");
      expect(groups[1]!.type).toBe("inactive");
    });

    it("returns no groups for no alerts", () => {
      expect(aggregateAlerts([])).toEqual([]);
    });
  });
});
