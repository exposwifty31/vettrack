/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const deleteOwnAccountMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    signOut: signOutMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  deleteOwnAccount: (...args: unknown[]) => deleteOwnAccountMock(...args),
}));

import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import { t } from "@/lib/i18n";

const CONFIRM_WORD = t.settingsPage.deleteAccountConfirmWord;

function getConfirmInput(): HTMLInputElement {
  const inputs = screen.getAllByTestId("delete-account-confirm-input");
  return inputs[inputs.length - 1] as HTMLInputElement;
}

function getConfirmButton(): HTMLButtonElement {
  const buttons = screen.getAllByTestId("delete-account-confirm-btn");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

function getCancelButton(): HTMLButtonElement {
  const buttons = screen.getAllByTestId("delete-account-cancel");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

describe("DeleteAccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteOwnAccountMock.mockResolvedValue({
      success: true,
      appleRevocation: "skipped",
      dbOutcome: "hard_deleted",
      clerkDeleted: true,
    });
    signOutMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps confirm disabled until the confirmation word matches", () => {
    render(<DeleteAccountDialog open onOpenChange={vi.fn()} />);

    const confirmBtn = getConfirmButton();
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(getConfirmInput(), {
      target: { value: "WRONG" },
    });
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(getConfirmInput(), {
      target: { value: CONFIRM_WORD },
    });
    expect(getConfirmButton().disabled).toBe(false);
  });

  it("deletes the account, shows success toast, and signs out", async () => {
    render(<DeleteAccountDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(getConfirmInput(), {
      target: { value: CONFIRM_WORD },
    });
    fireEvent.click(getConfirmButton());

    await waitFor(() => {
      expect(deleteOwnAccountMock).toHaveBeenCalledOnce();
    });
    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("recovers on deletion failure and allows retry", async () => {
    deleteOwnAccountMock.mockRejectedValueOnce(new Error("network"));
    const onOpenChange = vi.fn();

    render(<DeleteAccountDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(getConfirmInput(), {
      target: { value: CONFIRM_WORD },
    });
    fireEvent.click(getConfirmButton());

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledOnce();
    });
    expect(signOutMock).not.toHaveBeenCalled();

    const confirmBtn = getConfirmButton();
    expect(confirmBtn.disabled).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("ignores duplicate delete clicks while a request is in flight", async () => {
    let resolveDelete: (() => void) | undefined;
    deleteOwnAccountMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    render(<DeleteAccountDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(getConfirmInput(), {
      target: { value: CONFIRM_WORD },
    });

    const confirmBtn = getConfirmButton();
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteOwnAccountMock).toHaveBeenCalledOnce();
    });

    resolveDelete?.();
    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledOnce();
    });
  });

  it("blocks dialog close while deletion is in progress", async () => {
    let resolveDelete: (() => void) | undefined;
    deleteOwnAccountMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(<DeleteAccountDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(getConfirmInput(), {
      target: { value: CONFIRM_WORD },
    });
    fireEvent.click(getConfirmButton());

    fireEvent.click(getCancelButton());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveDelete?.();
    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledOnce();
    });
  });
});
