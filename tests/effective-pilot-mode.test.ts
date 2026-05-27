import { afterEach, describe, expect, it } from "vitest";
import {
  isEquipmentPilotBuildAllowed,
  resolveEffectiveRuntimePilotMode,
  resolveEffectiveVitePilotMode,
} from "../shared/effective-pilot-mode.js";

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe("effective-pilot-mode", () => {
  it("mainline ignores VITE_PILOT_MODE without ALLOW", () => {
    process.env.VITE_PILOT_MODE = "true";
    delete process.env.ALLOW_EQUIPMENT_PILOT_MODE;
    expect(resolveEffectiveVitePilotMode()).toBe(false);
  });

  it("equipment pilot requires both flags", () => {
    process.env.ALLOW_EQUIPMENT_PILOT_MODE = "true";
    process.env.VITE_PILOT_MODE = "true";
    process.env.PILOT_MODE = "true";
    expect(isEquipmentPilotBuildAllowed()).toBe(true);
    expect(resolveEffectiveVitePilotMode()).toBe(true);
    expect(resolveEffectiveRuntimePilotMode()).toBe(true);
  });

  it("ALLOW alone does not enable pilot", () => {
    process.env.ALLOW_EQUIPMENT_PILOT_MODE = "true";
    delete process.env.VITE_PILOT_MODE;
    delete process.env.PILOT_MODE;
    expect(resolveEffectiveVitePilotMode()).toBe(false);
    expect(resolveEffectiveRuntimePilotMode()).toBe(false);
  });
});
