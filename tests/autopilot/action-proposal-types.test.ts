import { describe, it, expect } from "vitest";
import {
  approveActionProposalBodySchema,
  editActionProposalBodySchema,
  rejectActionProposalBodySchema,
  crashCartDriftEditedContentSchema,
  shiftHandoverDraftEditedContentSchema,
  validateEditedContentForKind,
} from "../../server/lib/autopilot/action-proposal-types.js";

describe("action-proposal-types Zod contracts", () => {
  it("approve body accepts an empty object", () => {
    const result = approveActionProposalBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("approve body rejects unknown keys", () => {
    const result = approveActionProposalBodySchema.safeParse({ foo: "bar" });
    expect(result.success).toBe(false);
  });

  it("edit body requires a non-null object editedContent", () => {
    const ok = editActionProposalBodySchema.safeParse({ editedContent: { note: "changed" } });
    expect(ok.success).toBe(true);

    const missing = editActionProposalBodySchema.safeParse({});
    expect(missing.success).toBe(false);

    const nullContent = editActionProposalBodySchema.safeParse({ editedContent: null });
    expect(nullContent.success).toBe(false);

    const arrayContent = editActionProposalBodySchema.safeParse({ editedContent: [1, 2, 3] });
    expect(arrayContent.success).toBe(false);

    const stringContent = editActionProposalBodySchema.safeParse({ editedContent: "nope" });
    expect(stringContent.success).toBe(false);
  });

  it("reject body requires a non-empty rejectionReason string", () => {
    const ok = rejectActionProposalBodySchema.safeParse({ rejectionReason: "not applicable" });
    expect(ok.success).toBe(true);

    const whitespaceOnly = rejectActionProposalBodySchema.safeParse({ rejectionReason: "   " });
    expect(whitespaceOnly.success).toBe(false);

    const empty = rejectActionProposalBodySchema.safeParse({ rejectionReason: "" });
    expect(empty.success).toBe(false);

    const missing = rejectActionProposalBodySchema.safeParse({});
    expect(missing.success).toBe(false);
  });
});

describe("crashCartDriftEditedContentSchema (Task 1.1 §5, deliverable D)", () => {
  it("accepts a valid driftType with optional note and acknowledgedItemKeys", () => {
    const ok = crashCartDriftEditedContentSchema.safeParse({
      driftType: "missing_items",
      note: "Restocked manually",
      acknowledgedItemKeys: ["epinephrine"],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts driftType alone (note/acknowledgedItemKeys optional)", () => {
    const ok = crashCartDriftEditedContentSchema.safeParse({ driftType: "stale_check" });
    expect(ok.success).toBe(true);
  });

  it("rejects an invalid driftType", () => {
    const bad = crashCartDriftEditedContentSchema.safeParse({ driftType: "not_a_real_type" });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const bad = crashCartDriftEditedContentSchema.safeParse({ driftType: "missing_items", extra: "nope" });
    expect(bad.success).toBe(false);
  });

  it("is wired into validateEditedContentForKind for crash_cart_drift", () => {
    const valid = validateEditedContentForKind("crash_cart_drift", { driftType: "stale_check" });
    expect(valid.valid).toBe(true);
    const invalid = validateEditedContentForKind("crash_cart_drift", { driftType: "nope" });
    expect(invalid.valid).toBe(false);
  });
});

describe("shiftHandoverDraftEditedContentSchema (Task 1.1 §2, deliverable D)", () => {
  const validDeltas = { custody: [], taskState: [], alerts: [], dispenses: [] };

  it("accepts a well-formed deltas + openItems shape", () => {
    const ok = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: validDeltas,
      openItems: [{ id: "task-1", kind: "task", summary: "task_started:task-1" }],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts an optional note", () => {
    const ok = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: validDeltas,
      openItems: [],
      note: "Confirmed by phone with incoming lead",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a deltas object missing a dimension (garbage shape)", () => {
    const bad = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: { custody: [] },
      openItems: [],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a non-array deltas dimension", () => {
    const bad = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: { custody: "not-an-array", taskState: [], alerts: [], dispenses: [] },
      openItems: [],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a non-array openItems", () => {
    const bad = shiftHandoverDraftEditedContentSchema.safeParse({ deltas: validDeltas, openItems: "nope" });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const bad = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: validDeltas,
      openItems: [],
      extra: "nope",
    });
    expect(bad.success).toBe(false);
  });

  it("does not forbid a legitimate human edit: free-form delta entry text (kind/targetId are not constrained to a closed enum)", () => {
    const ok = shiftHandoverDraftEditedContentSchema.safeParse({
      deltas: {
        custody: [
          { sourceId: "manual-note-1", kind: "manually_noted_custody_event", targetId: null, targetType: null, at: "2026-07-22T09:00:00.000Z" },
        ],
        taskState: [],
        alerts: [],
        dispenses: [],
      },
      openItems: [],
    });
    expect(ok.success).toBe(true);
  });

  it("is wired into validateEditedContentForKind for shift_handover_draft", () => {
    const valid = validateEditedContentForKind("shift_handover_draft", { deltas: validDeltas, openItems: [] });
    expect(valid.valid).toBe(true);
    const invalid = validateEditedContentForKind("shift_handover_draft", { deltas: { custody: [] } });
    expect(invalid.valid).toBe(false);
  });
});
