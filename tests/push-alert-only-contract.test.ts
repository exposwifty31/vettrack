/**
 * ADR-009 §2 — push is an ALERT, never a state channel.
 *
 * The shared push payload contract must STRUCTURALLY forbid smuggling
 * authoritative domain/emergency state into a push. A push may carry alert copy
 * (title/body/tag/url/silent) plus an opaque reference id ONLY — never a field
 * the client would treat as truth (status, sessionState, phase, …). The client
 * learns truth from SSE/API; push just says "something happened, go look".
 *
 * Pure contract test — no db, no transports, no network.
 */
import { describe, it, expect } from "vitest";
import {
  assertAlertOnlyPayload,
  buildPushAlertEnvelope,
  PUSH_ALERT_ALLOWED_KEYS,
} from "@vettrack/contracts";

describe("ADR-009 push alert-only contract", () => {
  it("accepts a payload with only alert + referenceId keys", () => {
    expect(() =>
      assertAlertOnlyPayload({
        title: "Code Blue",
        body: "Room 3",
        tag: "code-blue",
        url: "/code-blue",
        silent: false,
        referenceId: "session-abc",
      }),
    ).not.toThrow();
  });

  it("rejects a payload carrying authoritative session state (would make push a state channel)", () => {
    expect(() =>
      assertAlertOnlyPayload({
        title: "Code Blue",
        body: "Room 3",
        sessionState: "active",
      } as Record<string, unknown>),
    ).toThrow(/non-alert|state channel|forbid/i);
  });

  it("rejects a payload carrying a domain status field", () => {
    expect(() =>
      assertAlertOnlyPayload({
        title: "x",
        body: "y",
        status: "ended",
      } as Record<string, unknown>),
    ).toThrow();
  });

  it("buildPushAlertEnvelope strips any non-allowlisted key rather than forwarding it", () => {
    const built = buildPushAlertEnvelope({
      title: "Battery low",
      body: "Ultrasound #7",
      referenceId: "equip-7",
      // a caller trying to smuggle state through the builder:
      status: "critical",
      sessionState: "active",
    } as Parameters<typeof buildPushAlertEnvelope>[0]);

    expect(Object.keys(built).sort()).toEqual(["body", "referenceId", "title"]);
    for (const key of Object.keys(built)) {
      expect(PUSH_ALERT_ALLOWED_KEYS).toContain(key);
    }
    // and the built envelope must itself pass the guard
    expect(() => assertAlertOnlyPayload(built as Record<string, unknown>)).not.toThrow();
  });
});
