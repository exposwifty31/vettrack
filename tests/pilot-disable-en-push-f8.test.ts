import { afterEach, describe, expect, it } from "vitest";
import { shouldSendPilotEnglishEquipmentPush } from "../server/lib/push.js";

describe("F8: PILOT_DISABLE_EN_PUSH", () => {
  const prior = process.env.PILOT_DISABLE_EN_PUSH;

  afterEach(() => {
    if (prior === undefined) delete process.env.PILOT_DISABLE_EN_PUSH;
    else process.env.PILOT_DISABLE_EN_PUSH = prior;
  });

  it("F8: sends English equipment pushes when env is unset", () => {
    delete process.env.PILOT_DISABLE_EN_PUSH;
    expect(shouldSendPilotEnglishEquipmentPush()).toBe(true);
  });

  it("F8: suppresses pushes when PILOT_DISABLE_EN_PUSH=true", () => {
    process.env.PILOT_DISABLE_EN_PUSH = "true";
    expect(shouldSendPilotEnglishEquipmentPush()).toBe(false);
  });
});
