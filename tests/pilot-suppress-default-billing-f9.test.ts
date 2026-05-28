import { afterEach, describe, expect, it } from "vitest";
import { isPilotDefaultBillingSuppressed } from "../server/lib/equipment-seen.js";

describe("F9: PILOT_SUPPRESS_DEFAULT_BILLING", () => {
  const prior = process.env.PILOT_SUPPRESS_DEFAULT_BILLING;

  afterEach(() => {
    if (prior === undefined) delete process.env.PILOT_SUPPRESS_DEFAULT_BILLING;
    else process.env.PILOT_SUPPRESS_DEFAULT_BILLING = prior;
  });

  it("F9: allows default billing item creation when env is unset", () => {
    delete process.env.PILOT_SUPPRESS_DEFAULT_BILLING;
    expect(isPilotDefaultBillingSuppressed()).toBe(false);
  });

  it("F9: suppresses default billing when PILOT_SUPPRESS_DEFAULT_BILLING=true", () => {
    process.env.PILOT_SUPPRESS_DEFAULT_BILLING = "true";
    expect(isPilotDefaultBillingSuppressed()).toBe(true);
  });
});
