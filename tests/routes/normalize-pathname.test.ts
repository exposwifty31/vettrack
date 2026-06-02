import { describe, expect, it } from "vitest";
import { normalizePathname } from "../../src/lib/routes/normalize-pathname.js";

describe("normalizePathname", () => {
  it.each([
    ["", "/"],
    ["display", "/display"],
    ["/display", "/display"],
    ["/display/", "/display"],
    ["/display//", "/display"],
    ["/locations/123/", "/locations/123"],
    ["/locations//123", "/locations//123"],
    ["/display?mode=wall", "/display"],
    ["/display#kiosk", "/display"],
    ["/display?mode=wall#kiosk", "/display"],
    ["https://example.com/display?mode=wall#kiosk", "/display"],
    ["//example.com/display", "/display"],
    ["?mode=wall", "/"],
    ["#kiosk", "/"],
  ] as const)("normalizes %s", (input, expected) => {
    expect(normalizePathname(input)).toBe(expected);
  });
});
