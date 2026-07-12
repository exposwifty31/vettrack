/**
 * @vitest-environment happy-dom
 *
 * T19 roster-import UX coverage on the admin shifts import page:
 *   - the accepted-shift-names keyword list (fetched from
 *     GET /api/shifts/import/shift-names) actually renders — the parser no
 *     longer fails opaquely with no hint of what it recognizes.
 *   - a successful /import/confirm invalidates the import-history query so
 *     the new import appears without a manual reload.
 *
 * T18 coverage: the preview card surfaces which import path (doctor vs
 * roster) a CSV took — the "UI control" that makes the doctor-CSV path
 * usable through the product instead of only the UI-less legacy /import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

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

// AppShell pulls in the real Topbar/WebShell (useAuth/useQuery/native-shell
// context) — stub it to a passthrough, same pattern as console-management.test.tsx.
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

describe("AdminShiftsPage — accepted shift-names list (T19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.mockResolvedValue([]);
    hintsMock.mockResolvedValue({
      technician: ["טכנאי", "technician"],
      seniorTechnician: ["בכיר", "lead technician"],
      admin: ["מנהל", "manager"],
    });
  });
  afterEach(() => cleanup());

  it("renders the keyword list fetched from GET /api/shifts/import/shift-names", async () => {
    renderPage();
    await waitFor(() => expect(hintsMock).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("טכנאי")).toBeTruthy();
    expect(screen.getByText("בכיר")).toBeTruthy();
    expect(screen.getByText("lead technician")).toBeTruthy();
    expect(screen.getByText("מנהל")).toBeTruthy();
  });
});

describe("AdminShiftsPage — import-history refetch after confirm (T19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.mockResolvedValue([]);
    hintsMock.mockResolvedValue({ technician: [], seniorTechnician: [], admin: [] });
    previewMock.mockResolvedValue({
      kind: "roster",
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
    });
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

  it("invalidates the ['/api/shifts/imports'] query after a successful confirm", async () => {
    const { qc, container } = renderPage();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByTestId("btn-confirm-shifts-import") as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId("btn-confirm-shifts-import"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));

    // Would fail against the pre-fix regression this test guards: a confirm
    // that never invalidates ["/api/shifts/imports"] leaves the history list
    // stale until a manual reload.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/shifts/imports"] }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe("AdminShiftsPage — doctor vs roster import is visible in the preview card (T18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.mockResolvedValue([]);
    hintsMock.mockResolvedValue({ technician: [], seniorTechnician: [], admin: [] });
  });
  afterEach(() => cleanup());

  it("shows the roster-import badge and roster columns for a kind: roster preview", async () => {
    previewMock.mockResolvedValue({
      kind: "roster",
      filename: "roster.csv",
      summary: { totalRows: 1, validRows: 1, skippedRows: 0 },
      rows: [
        { rowNumber: 2, date: "2026-07-05", startTime: "08:00", endTime: "16:00", employeeName: "WC A", shiftName: "טכנאי בוקר", role: "technician" },
      ],
      issues: [],
    });
    const { container } = renderPage();
    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));

    await waitFor(() => expect(screen.getByTestId("shift-import-kind-badge")).toBeTruthy());
    expect(screen.getByText("WC A")).toBeTruthy();
  });

  it("shows the doctor-import badge and userId column for a kind: doctor preview", async () => {
    previewMock.mockResolvedValue({
      kind: "doctor",
      filename: "doctors.csv",
      summary: { totalRows: 1, validRows: 1, skippedRows: 0 },
      rows: [
        {
          rowNumber: 2,
          date: "2026-07-05",
          startTime: "08:00",
          endTime: "16:00",
          userId: "user-1",
          shiftName: "Admission shift",
          operationalRole: "admission",
        },
      ],
      issues: [],
    });
    const { container } = renderPage();
    const file = new File(["x"], "doctors.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));

    await waitFor(() => expect(screen.getByTestId("shift-import-kind-badge")).toBeTruthy());
    // Doctor rows render the userId, not an employeeName column.
    expect(screen.getByText("user-1")).toBeTruthy();
    expect(screen.queryByText("WC A")).toBeNull();
  });
});

describe("AdminShiftsPage — failure paths (CodeRabbit PR #83 coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("shows an ErrorCard (not a silent empty state) when the accepted-shift-names fetch fails", async () => {
    hintsMock.mockRejectedValue(new Error("hints down"));
    renderPage();

    await waitFor(() => expect(hintsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t.adminShiftsPage.acceptedShiftNamesLoadFailed)).toBeTruthy();
  });

  it("surfaces a toast (not a silent no-op) when CSV preview generation fails", async () => {
    hintsMock.mockResolvedValue({ technician: [], seniorTechnician: [], admin: [] });
    previewMock.mockRejectedValueOnce(new Error("Malformed CSV header"));
    const { container } = renderPage();

    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Malformed CSV header"));
    // No stale preview card should render off a failed preview call.
    expect(screen.queryByTestId("shift-import-kind-badge")).toBeNull();
  });

  it("surfaces a toast (not a silent no-op) when import confirm fails", async () => {
    hintsMock.mockResolvedValue({ technician: [], seniorTechnician: [], admin: [] });
    previewMock.mockResolvedValue({
      kind: "roster",
      filename: "roster.csv",
      summary: { totalRows: 1, validRows: 1, skippedRows: 0 },
      rows: [
        { rowNumber: 2, date: "2026-07-05", startTime: "08:00", endTime: "16:00", employeeName: "WC A", shiftName: "טכנאי בוקר", role: "technician" },
      ],
      issues: [],
    });
    confirmMock.mockRejectedValueOnce(new Error("Server rejected the import"));
    const { container } = renderPage();

    const file = new File(["x"], "roster.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("btn-preview-shifts-csv"));
    await waitFor(() =>
      expect((screen.getByTestId("btn-confirm-shifts-import") as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId("btn-confirm-shifts-import"));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    // Preview succeeding has its own (unrelated) success toast — only the
    // confirm-failure toast matters here.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Server rejected the import"));
  });
});
