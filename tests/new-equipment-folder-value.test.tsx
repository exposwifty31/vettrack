/**
 * @vitest-environment happy-dom
 *
 * T-18 (R-EQ-04 · CLICK-PATH-036) — editing an already-filed equipment item
 * showed "Unfiled" in the Folder / Category Select instead of the item's
 * real folder. In src/pages/new-equipment.tsx the folder <Select> used a
 * static `defaultValue={prefill.folderId || "none"}` — `prefill` only ever
 * reflects copy-prefill query params (`?copyFolder=`), never
 * `existingEquipment.folderId` — so on the edit route it always fell back to
 * "none" ("Unfiled") regardless of what folder the loaded equipment was
 * actually filed under.
 *
 * This test renders the edit form for an equipment row with a non-null
 * folderId and asserts the Select displays THAT folder's name, not the
 * "Unfiled" placeholder/none label.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import { t } from "@/lib/i18n";
import type { Equipment, Folder } from "@/types";
import type { ReactNode } from "react";

afterEach(() => cleanup());

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: false, userId: "u1" }),
}));

// The full app chrome (Topbar, sidebar nav, ...) is irrelevant to this
// mount-time value defect — stub it to a passthrough.
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn() },
}));

const equipmentGetMock = vi.fn();
const foldersListMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        get: (...args: unknown[]) => equipmentGetMock(...args),
      },
      folders: {
        ...actual.api.folders,
        list: (...args: unknown[]) => foldersListMock(...args),
      },
    },
  };
});

import NewEquipmentPage from "@/pages/new-equipment";

const FOLDERS: Folder[] = [
  { id: "folder-1", name: "General", type: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "folder-2", name: "Anesthesia Cart", type: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
];

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq1",
    name: "Infusion Pump",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function renderEditForm(equipment: Equipment) {
  equipmentGetMock.mockResolvedValue(equipment);
  foldersListMock.mockResolvedValue(FOLDERS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: `/equipment/${equipment.id}/edit` });
  render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <Router hook={hook}>
          <Route path="/equipment/:id/edit">
            <NewEquipmentPage />
          </Route>
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
  // Wait past the loading skeleton for the real form to mount.
  return screen.findByTestId("select-folder");
}

describe("new-equipment edit form — folder Select reflects the item's actual folder (T-18)", () => {
  it("shows the equipment's real folder, not the Unfiled placeholder", async () => {
    const select = await renderEditForm(baseEquipment({ folderId: "folder-2" }));

    // Give the post-load reset() effect a chance to settle before asserting
    // the final displayed value.
    await waitFor(() => {
      expect(select.textContent).toContain("Anesthesia Cart");
    });
    expect(select.textContent).not.toContain(t.newEquipment.fields.folder.none);
  });

  /**
   * T-18b (device sweep 2026-07-13) — the COLD-CACHE race the test above
   * misses. When the folders query resolves AFTER the equipment query (fresh
   * app launch, nothing cached), the form renders with `folderId` already set
   * but the folder `<SelectItem>` options not yet mounted. A controlled Radix
   * Select given a value with no matching item falls back to "Unfiled" and
   * sticks there until the user interacts — so a save that never touched the
   * field silently UN-FILES the equipment. The folder Select must not mount
   * until its options have loaded.
   */
  it("does not mount the folder Select with a value before its options load (cold-cache race)", async () => {
    let resolveFolders!: (v: Folder[]) => void;
    foldersListMock.mockReturnValue(
      new Promise<Folder[]>((res) => {
        resolveFolders = res;
      }),
    );
    equipmentGetMock.mockResolvedValue(baseEquipment({ folderId: "folder-2" }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook } = memoryLocation({ path: "/equipment/eq1/edit" });
    render(
      <HelmetProvider>
        <QueryClientProvider client={client}>
          <Router hook={hook}>
            <Route path="/equipment/:id/edit">
              <NewEquipmentPage />
            </Route>
          </Router>
        </QueryClientProvider>
      </HelmetProvider>,
    );

    // Equipment has resolved but folders is still pending: the folder Select
    // must NOT be mounted yet (mounting it with folderId set but zero options
    // is exactly what strands it on "Unfiled").
    await expect(
      screen.findByTestId("select-folder", {}, { timeout: 600 }),
    ).rejects.toThrow();

    // Once folders load, the Select appears and reflects the real folder.
    resolveFolders(FOLDERS);
    const select = await screen.findByTestId("select-folder");
    await waitFor(() => expect(select.textContent).toContain("Anesthesia Cart"));
    expect(select.textContent).not.toContain(t.newEquipment.fields.folder.none);
  });
});
