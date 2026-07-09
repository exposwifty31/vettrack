import { describe, it, expect } from "vitest";
import { t } from "@/lib/i18n";
import { consoleStatusLabel } from "@/lib/console-status-label";

describe("consoleStatusLabel (M1 — localize console status enums)", () => {
  it("maps known statuses to their localized labels", () => {
    expect(consoleStatusLabel("active")).toBe(t.console.stActive);
    expect(consoleStatusLabel("completed")).toBe(t.console.stCompleted);
    expect(consoleStatusLabel("rejected_signature")).toBe(t.console.stRejectedSignature);
    expect(consoleStatusLabel("replay_pending")).toBe(t.console.stReplayPending);
    expect(consoleStatusLabel("draft")).toBe(t.console.stDraft);
  });

  it("falls through unknown statuses raw (never crashes on a new server status)", () => {
    expect(consoleStatusLabel("some_future_status")).toBe("some_future_status");
    expect(consoleStatusLabel("")).toBe("");
  });
});
