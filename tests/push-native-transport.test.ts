/**
 * G4-2 — native transport classification + APNs sound selection (ADR-009).
 *
 * Pure-function coverage for two safety-relevant decisions in the native
 * transports:
 *   - classifyFcmError: which FCM error codes delete a subscription vs. retry.
 *     A credential misconfig (`messaging/mismatched-credential`) must NOT be
 *     treated as a dead token — deleting the subscription over a server-side
 *     misconfiguration would silently unsubscribe healthy devices.
 *   - apnsSoundForPayload: a subscription that disabled sound (silent) must get
 *     NO APNs sound at all, even when critical-sound is configured.
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
