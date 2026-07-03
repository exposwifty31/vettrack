/**
 * @vitest-environment happy-dom
 *
 * C1 (UX audit, clinical-risk) — the CODE BLUE start button rendered armed
 * but silently no-oped: `disabled` gated on managerId only while the click
 * handler also required managerName, and managerName was seeded into state
 * from `useAuth().name` at mount (frequently still empty). These tests lock
 * the fixed contract: the disabled state and the click gate are the SAME
 * condition, a missing display name never blocks an eligible manager, and
 * the in-flight state visibly disables the button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import { PreCheckGate } from "@/pages/code-blue";

const authState: { userId: string | null; role: string; name: string | null } = {
  userId: "u-vet-1",
  role: "vet",
  name: "",
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

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

describe("PreCheckGate — C1 start-button contract", () => {
  afterEach(() => {
    cleanup();
    authState.userId = "u-vet-1";
    authState.role = "vet";
    authState.name = "";
  });

  it("eligible manager with an EMPTY display name can still start (fallback label)", () => {
    const { onStart } = renderGate();
    const button = screen.getByTestId("code-blue-start") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(false, {
      id: "u-vet-1",
      name: t.codeBlue.managerFallbackName,
    });
  });

  it("eligible manager with a name passes the real name through", () => {
    authState.name = "Dr. Vet";
    const { onStart } = renderGate();
    fireEvent.click(screen.getByTestId("code-blue-start"));
    expect(onStart).toHaveBeenCalledWith(false, { id: "u-vet-1", name: "Dr. Vet" });
  });

  it("non-eligible user without a picked manager: disabled state matches the click gate + reason shown", () => {
    authState.role = "technician";
    const { onStart } = renderGate();
    const button = screen.getByTestId("code-blue-start") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(t.codeBlue.startDisabledReason)).toBeTruthy();

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("while starting, the button is disabled and shows the in-flight label", () => {
    const { onStart } = renderGate({ starting: true });
    const button = screen.getByTestId("code-blue-start") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(t.codeBlue.startingSession);

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });
});
