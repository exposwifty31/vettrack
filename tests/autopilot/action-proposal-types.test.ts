import { describe, it, expect } from "vitest";
import {
  approveActionProposalBodySchema,
  editActionProposalBodySchema,
  rejectActionProposalBodySchema,
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

    const empty = rejectActionProposalBodySchema.safeParse({ rejectionReason: "" });
    expect(empty.success).toBe(false);

    const missing = rejectActionProposalBodySchema.safeParse({});
    expect(missing.success).toBe(false);
  });
});
