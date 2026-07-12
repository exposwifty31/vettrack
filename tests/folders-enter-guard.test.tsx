/**
 * @vitest-environment happy-dom
 *
 * T-43 (R-AD-04 · CLICK-PATH-024) — in src/pages/admin/FoldersSection.tsx the
 * Enter-key handler on the folder-name input replicated the Save button's
 * mutate call WITHOUT the guards the button applies via its `disabled` prop
 * (non-empty/trimmed name, and not already pending). As a result:
 *   - Enter with an empty/whitespace-only name submitted an empty folder.
 *   - A rapid double-Enter fired the mutation twice, creating a duplicate
 *     folder, since the handler never checked `createMut.isPending`.
 *
 * GREEN extracts one guarded `submit()` used by both the Save button and the
 * Enter handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Folder } from "@/types";

afterEach(() => cleanup());

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "admin-1", isAdmin: true }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

const listMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    folders: {
      list: (...a: unknown[]) => listMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { FoldersSection } from "@/pages/admin/FoldersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FoldersSection />
    </QueryClientProvider>,
  );
}

function nameInput(): HTMLInputElement {
  return screen.getByTestId("input-folder-name") as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByTestId("btn-save-folder") as HTMLButtonElement;
}

async function openCreateDialog() {
  fireEvent.click(screen.getByTestId("btn-create-folder"));
  await screen.findByTestId("input-folder-name");
}

const EXISTING: Folder[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(EXISTING);
});

describe("FoldersSection — Enter handler reuses the guarded submit (T-43 · R-AD-04)", () => {
  it("does not submit when Enter is pressed with an empty/whitespace name", async () => {
    renderSection();
    await openCreateDialog();

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.keyDown(nameInput(), { key: "Enter" });

    // The mutation's own pending-state notification is scheduled via a
    // macrotask (TanStack Query's notifyManager), so give any wrongly-fired
    // call a real chance to land before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createMock).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
  });

  it("submits at most once on a rapid double-Enter", async () => {
    let resolveCreate!: (value: Folder) => void;
    createMock.mockImplementation(
      () =>
        new Promise<Folder>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderSection();
    await openCreateDialog();

    fireEvent.change(nameInput(), { target: { value: "Surgery Room 1" } });

    fireEvent.keyDown(nameInput(), { key: "Enter" });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // Once the mutation is in flight, the guard must treat a second Enter
    // exactly like the (already-disabled) Save button would.
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    fireEvent.keyDown(nameInput(), { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createMock).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: "f1",
      name: "Surgery Room 1",
      type: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await waitFor(() => expect(screen.queryByTestId("input-folder-name")).toBeNull());
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
