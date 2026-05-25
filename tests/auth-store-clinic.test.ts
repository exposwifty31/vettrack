import { beforeEach, describe, expect, it } from "vitest";
import {
  getCurrentClinicId,
  setAuthState,
  setCurrentClinicId,
} from "../src/lib/auth-store";

describe("auth-store clinic snapshot", () => {
  beforeEach(() => {
    setAuthState({
      userId: "",
      email: "",
      name: "",
      bearerToken: null,
    });
    setCurrentClinicId();
  });

  it("setCurrentClinicId stores trimmed clinicId", () => {
    setCurrentClinicId("  clinic-alpha  ");
    expect(getCurrentClinicId()).toBe("clinic-alpha");
  });

  it("getCurrentClinicId returns empty string when unset", () => {
    expect(getCurrentClinicId()).toBe("");
  });

  it("setCurrentClinicId clears clinicId", () => {
    setCurrentClinicId("clinic-beta");
    setCurrentClinicId();
    expect(getCurrentClinicId()).toBe("");
  });
});
