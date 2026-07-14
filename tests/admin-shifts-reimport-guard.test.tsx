/**
 * @vitest-environment happy-dom
 *
 * T-42 (R-AD-03 · CLICK-PATH-023): after a successful roster-CSV import, the
 * Import button must NOT stay clickable for the same accepted file — nothing
 * previously marked the file as "already imported", so canImport stayed true
 * and a second click re-imported the SAME CSV (duplicate shifts). Choosing a
 * new file must re-enable the flow once it is previewed again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const importsMock = vi.fn();
const hintsMock = vi.fn();
const previewMock = vi.fn();
const confirmMock = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: true, userId: "admin-1" }),
}));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    shifts: {
      imports: (...a: unknown[]) => importsMock(...a),
      importShiftNameHints: (...a: unknown[]) => hintsMock(...a),
      previewImport: (...a: unknown[]) => previewMock(...a),
      confirmImport: (...a: unknown[]) => confirmMock(...a),
    },
  },
}));

import AdminShiftsPage from "@/pages/admin-shifts";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <AdminShiftsPage />
    </QueryClientProvider>,
  );
  return { qc, ...view };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

function confirmButton(): HTMLButtonElement {
  return screen.getByTestId("btn-confirm-shifts-import") as HTMLButtonElement;
}

const rosterPreview = {
  kind: "roster" as const,
  filename: "roster.csv",
  summary: { totalRows: 1, validRows: 1, skippedRows: 0 },
  rows: [
    {
      rowNumber: 2,
      date: "2026-07-05",
      startTime: "08:00",
      endTime: "16:00",
      employeeName: "WC A",
      shiftName: "טכנאי בוקר",
      role: "technician",
    },
  ],
  issues: [],
};

describe("AdminShiftsPage — re-import guard (T-42 · R-AD-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.mockResolvedValue([]);
    hintsMock.mockResolvedValue({ technician: [], seniorTechnician: [], admin: [] });
    previewMock.mockResolvedValue(rosterPreview);
    confirmMock.mockResolvedValue({
      kind: "roster",
      importId: "import-1",
      filename: "roster.csv",
      insertedRows: 1,
      skippedRows: 0,
      issues: [],
    });
  });
  afterEach(() => cleanup());

  it("disables Import for the same file after a successful confirm, and blocks a second click from re-importing", async () => {
    const { container } = renderPage();

    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));

    // The regression this guards: canImport stayed true after a successful
    // confirm, so the SAME file could be re-imported by clicking again.
    await waitFor(() => expect(confirmButton().disabled).toBe(true));

    fireEvent.click(confirmButton());
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("re-enables Import once a new file is chosen and previewed", async () => {
    const { container } = renderPage();

    const fileA = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [fileA] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmButton().disabled).toBe(true));

    const fileB = new File(["y"], "roster-2.csv", { type: "text/csv" });
    previewMock.mockResolvedValueOnce({ ...rosterPreview, filename: "roster-2.csv" });
    fireEvent.change(fileInput(container), { target: { files: [fileB] } });

    // Selecting a new file clears the stale preview — Import stays disabled
    // until the new file is previewed again.
    expect(confirmButton().disabled).toBe(true);

    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2));
  });

  it("surfaces an error toast and re-enables Import (not stuck disabled) when confirm fails", async () => {
    const { container } = renderPage();
    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    confirmMock.mockRejectedValueOnce(new Error("import failed"));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toastError).toHaveBeenCalled());

    // A rejected confirm must not be treated as "already imported" — the
    // same file can be retried.
    expect(confirmButton().disabled).toBe(false);
  });
});
