/**
 * @vitest-environment happy-dom
 *
 * T-49 (CLICK-PATH-031) — the items→confirm transition unconditionally called
 * `setSelectedAnimalId(undefined)`, wiping a `patientId` passed via props (e.g.
 * ER Command Center quick-scan pre-select). So a pre-selected patient was lost
 * on Continue, leaving the confirm step's primary action disabled
 * (`selectedAnimalId === undefined`). The transition must preserve
 * `patientIdProp`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    restock: {
      containerItems: vi.fn().mockResolvedValue({
        container: { id: "c1", name: "Test Cart" },
        lines: [{ itemId: "i1", actual: 5, label: "Gauze", code: "G1" }],
      }),
    },
    containers: { dispense: vi.fn(), completeEmergency: vi.fn() },
  },
}));

import { DispenseSheet } from "@/features/containers/components/DispenseSheet";

beforeAll(() => {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (!g.crypto) g.crypto = {};
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => "test-uuid-" + Math.random();
});

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DispenseSheet containerId="c1" isOpen onClose={() => {}} patientId="p1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DispenseSheet — preserves the pre-selected patient on Continue (T-49)", () => {
  it("keeps patientIdProp so the confirm action stays enabled", async () => {
    renderSheet();

    // Wait for the item to load, then select one so Continue enables.
    await waitFor(() => expect(screen.getByLabelText(t.dispense.sheet.increase)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(t.dispense.sheet.increase));

    // items → confirm.
    fireEvent.click(screen.getByText(t.dispense.sheet.continue));

    // With the patient preserved, the confirm primary action is not disabled.
    const confirmBtn = screen.getByText(t.dispense.sheet.confirmTake).closest("button") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });
});
