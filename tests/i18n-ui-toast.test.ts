import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { toastSuccess, toastError } from "../src/lib/ui-toast";

/**
 * Phase 6 PR 6.4 — canonical client toast wrappers.
 *
 * `toastSuccess` / `toastError` accept a resolved string. The signature
 * is intentionally `(message: string, opts?)` so callers pass `t.x.y`
 * accessor results directly. PR 6.14's typed `t` generator will catch
 * invalid accessor paths at the call site.
 */

describe("toastSuccess / toastError wrappers", () => {
  beforeEach(() => {
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("toastSuccess forwards the resolved string to sonner.toast.success", () => {
    toastSuccess("Resource saved");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Resource saved", undefined);
  });

  it("toastSuccess forwards options when provided", () => {
    toastSuccess("Resource saved", { id: "save-toast" });
    expect(toast.success).toHaveBeenCalledWith("Resource saved", { id: "save-toast" });
  });

  it("toastError forwards the resolved string to sonner.toast.error", () => {
    toastError("Save failed");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Save failed", undefined);
  });

  it("toastError forwards options when provided", () => {
    toastError("Save failed", { id: "error-toast" });
    expect(toast.error).toHaveBeenCalledWith("Save failed", { id: "error-toast" });
  });

  it("does not introspect the message argument (caller supplies resolved t.x.y)", () => {
    // Wrappers must be transparent — no key-path parsing, no internal-key
    // guard, no localization at this layer. The runtime guard for
    // internal keys lives on the SERVER side (apiError) where keys are
    // strings; client `t` is structurally accessor-driven and any
    // `_meta` exposure is prevented by `stripInternalKeys` at the
    // accessor builder.
    toastSuccess("_meta.someKey");
    expect(toast.success).toHaveBeenCalledWith("_meta.someKey", undefined);
  });
});
