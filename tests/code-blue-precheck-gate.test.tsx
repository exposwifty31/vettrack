/**
 * @vitest-environment happy-dom
 *
 * C1 (UX audit, clinical-risk) — the CODE BLUE commit affordance must never be
 * armed-but-silent: the gate that DISABLES it and the gate that lets it COMMIT
 * are the SAME condition (an event manager is resolved), a missing display name
 * never blocks an eligible manager, and the in-flight state visibly disables it.
 *
 * R-CBF-1.3 replaced the plain start button with the arm→hold-to-confirm control
 * (a completed 800ms hold commits, carrying the per-gesture idempotency token).
 * These tests lock the same C1 contract against the hold control.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

vi.mock("@/lib/haptics", () => ({
  haptics: { warning: vi.fn(), locked: vi.fn(), error: vi.fn(), tap: vi.fn(), scanSuccess: vi.fn() },
}));

const authState: { userId: string | null; role: string; name: string | null } = {
  userId: "u-vet-1",
  role: "vet",
  name: "",
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

import { PreCheckGate } from "@/pages/code-blue";

function renderGate(props: { onStart?: ReturnType<typeof vi.fn>; starting?: boolean } = {}) {
  const onStart = props.onStart ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PreCheckGate onStart={onStart} starting={props.starting ?? false} />
    </QueryClientProvider>,
  );
  return { onStart };
}

function holdButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: t.codeBlue.hold.instruction }) as HTMLButtonElement;
}

/** Complete an exactly-800ms press-and-hold on the commit control. */
function completeHold(el: HTMLButtonElement) {
  fireEvent.pointerDown(el);
  act(() => vi.advanceTimersByTime(800));
}

describe("PreCheckGate — C1 commit-gate contract (arm→hold)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    authState.userId = "u-vet-1";
    authState.role = "vet";
    authState.name = "";
  });

  it("eligible manager with an EMPTY display name can still commit (fallback label)", () => {
    const { onStart } = renderGate();
    const hold = holdButton();
    expect(hold.disabled).toBe(false);

    completeHold(hold);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(
      false,
      { id: "u-vet-1", name: t.codeBlue.managerFallbackName },
      expect.any(String),
    );
  });

  it("eligible manager with a name passes the real name through", () => {
    authState.name = "Dr. Vet";
    const { onStart } = renderGate();
    completeHold(holdButton());
    expect(onStart).toHaveBeenCalledWith(false, { id: "u-vet-1", name: "Dr. Vet" }, expect.any(String));
  });

  it("non-eligible user without a picked manager: disabled state matches the commit gate + reason shown", () => {
    authState.role = "technician";
    const { onStart } = renderGate();
    const hold = holdButton();
    expect(hold.disabled).toBe(true);
    expect(screen.getByText(t.codeBlue.startDisabledReason)).toBeTruthy();

    completeHold(hold);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("admin is NOT auto-selected as the event manager (F3): commit stays disabled until one is picked", () => {
    authState.role = "admin";
    authState.userId = "u-admin-1";
    const { onStart } = renderGate();
    const hold = holdButton();
    expect(hold.disabled).toBe(true);
    expect(screen.getByText(t.codeBlue.startDisabledReason)).toBeTruthy();
    // The auto-fill "…(you)" manager card is NOT rendered for an admin.
    expect(screen.queryByText(t.codeBlue.you)).toBeNull();

    completeHold(hold);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("while starting, the control is disabled and shows the in-flight label", () => {
    const { onStart } = renderGate({ starting: true });
    const hold = holdButton();
    expect(hold.disabled).toBe(true);
    expect(screen.getByText(t.codeBlue.startingSession)).toBeTruthy();

    completeHold(hold);
    expect(onStart).not.toHaveBeenCalled();
  });
});
