/**
 * G4-2 — native transport safety decisions (ADR-009).
 *
 * Guards two safety guarantees: a server-side credential misconfig must never be
 * mistaken for a dead token (which would silently unsubscribe healthy devices),
 * and a subscription that disabled sound must stay silent.
 *
 * Pure — no db, no transports, no network.
 */
import { describe, it, expect } from "vitest";
import { classifyFcmError } from "../server/lib/push-fcm.js";
import { apnsSoundForPayload } from "../server/lib/push-apns.js";

describe("classifyFcmError — FCM error → cleanup decision", () => {
  it("maps registration-token-not-registered to expired (delete)", () => {
    expect(classifyFcmError("messaging/registration-token-not-registered")).toBe("expired");
  });

  it("maps invalid-registration-token to invalid (delete)", () => {
    expect(classifyFcmError("messaging/invalid-registration-token")).toBe("invalid");
  });

  it("maps invalid-argument to invalid (delete)", () => {
    expect(classifyFcmError("messaging/invalid-argument")).toBe("invalid");
  });

  it("maps mismatched-credential to error (NEVER delete — server misconfig, not a dead token)", () => {
    expect(classifyFcmError("messaging/mismatched-credential")).toBe("error");
  });

  it("maps an unknown/transient code to error", () => {
    expect(classifyFcmError("messaging/internal-error")).toBe("error");
    expect(classifyFcmError(undefined)).toBe("error");
  });
});

describe("apnsSoundForPayload — silent honors a sound-disabled subscription", () => {
  it("returns undefined when the payload is silent, even with critical sound configured", () => {
    expect(apnsSoundForPayload(true, true)).toBeUndefined();
    expect(apnsSoundForPayload(true, false)).toBeUndefined();
  });

  it("returns the critical-sound object for a non-silent payload when critical is configured", () => {
    expect(apnsSoundForPayload(false, true)).toEqual({ critical: 1, name: "default", volume: 1 });
  });

  it("returns the default sound for a non-silent payload without critical sound", () => {
    expect(apnsSoundForPayload(false, false)).toBe("default");
  });

  it("treats an undefined silent flag as non-silent", () => {
    expect(apnsSoundForPayload(undefined, false)).toBe("default");
  });
});
