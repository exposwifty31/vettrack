import { describe, it, expect } from "vitest";
import { maskPhone, maskPushEndpoint } from "../shared/notification-delivery.js";

describe("maskPhone (7b notification PII masking)", () => {
  it("keeps only the last 4 digits and never leaks the full number", () => {
    const masked = maskPhone("0501234567");
    expect(masked.endsWith("4567")).toBe(true);
    expect(masked).not.toContain("0501234567");
    expect(masked).not.toMatch(/050123/); // leading digits are masked
  });

  it("strips non-digits before masking", () => {
    const masked = maskPhone("+972-50-123-4567");
    expect(masked.endsWith("4567")).toBe(true);
    expect(masked).not.toContain("972");
  });

  it("masks entirely when 4 or fewer digits, and handles empty", () => {
    expect(maskPhone("123")).toBe("•••");
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("")).toBe("—");
  });
});

describe("maskPushEndpoint (7b push endpoint masking)", () => {
  it("exposes only host + a short tail, never the full token", () => {
    const masked = maskPushEndpoint("https://fcm.googleapis.com/fcm/send/AbCdEf123456");
    expect(masked).toContain("fcm.googleapis.com");
    expect(masked.endsWith("3456")).toBe(true);
    expect(masked).not.toContain("AbCdEf123456");
    expect(masked).not.toContain("/fcm/send/");
  });

  it("handles unparseable endpoints and empties", () => {
    expect(maskPushEndpoint("garbage-value")).toBe("…alue");
    expect(maskPushEndpoint(null)).toBe("—");
    expect(maskPushEndpoint("")).toBe("—");
  });
});
