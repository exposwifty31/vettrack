/**
 * Web alerts dropdown ↔ badge consistency (Bugbot 863bddeb).
 *
 * The bell badge counts UNACKED alerts (countActiveAlerts with the ack set),
 * so the dropdown panel must aggregate the same filtered set — otherwise the
 * panel shows rows/totals for alerts the badge no longer counts. Native got
 * this right first (NativeHeader aggregates filterUnackedAlerts); both web
 * call sites must match it (mobile is the source of truth).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("web AlertsDropdown receives unacked-only alerts", () => {
  it("Topbar filters acked alerts before the dropdown", () => {
    const topbar = read("src/components/layout/Topbar.tsx");
    expect(topbar).toContain("alerts={filterUnackedAlerts(alerts, alertAckSet)}");
  });

  it("legacy layout filters acked alerts before the dropdown", () => {
    const layout = read("src/components/layout.tsx");
    expect(layout).toContain("alerts={filterUnackedAlerts(alerts, alertAckSet)}");
  });

  it("native header keeps the reference pattern", () => {
    const native = read("src/native/NativeHeader.tsx");
    expect(native).toContain("aggregateAlerts(filterUnackedAlerts(alerts, alertAckSet))");
  });
});
