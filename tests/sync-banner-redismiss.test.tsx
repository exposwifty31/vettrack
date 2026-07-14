/**
 * @vitest-environment happy-dom
 *
 * T-36 (R-SY-02 · CLICK-PATH-013) `⚠ FROZEN` — `dismissed` in
 * src/components/sync-status-banner.tsx was a component-local boolean with
 * no reset, so after ONE dismissal every later sync failure — including a
 * distinct, more serious one (e.g. "billing leakage") — stayed hidden for
 * the rest of the session.
 *
 * GREEN: dismissal is keyed to the failure signature — `(syncErrorKind,
 * targetResource)` — derived from the primary failing queue row already
 * exposed by `useSync()` (`deadLetterItems` / `retryableFailedItems`:
 * `structuredError.code` for the kind, `endpoint` for the resource/mutation
 * it concerns). Two failures share a signature iff BOTH fields are equal.
 *
 * This suite asserts: dismissing a signature hides it; an IDENTICAL
 * signature (same kind + same resource) stays hidden across re-renders
 * (persistence); a signature differing in EITHER field re-shows the banner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PendingSync } from "@/lib/offline-db";

interface MockSyncState {
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
  isCircuitOpen: boolean;
  triggerSync: () => void;
  deadLetterItems: PendingSync[];
  retryableFailedItems: PendingSync[];
}

let mockSyncState: MockSyncState;

vi.mock("@/hooks/use-sync", () => ({
  useSync: () => mockSyncState,
}));

// Imported after the mock so the component picks up the mocked hook.
import { SyncStatusBanner } from "@/components/sync-status-banner";

function row(overrides: Partial<PendingSync> & Pick<PendingSync, "status">): PendingSync {
  return {
    type: "return_with_charge",
    endpoint: "/api/dispense-events",
    method: "POST",
    body: "{}",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    retries: 5,
    clientTimestamp: Date.now(),
    clientMutationId: "m1",
    idempotencyKey: "k1",
    schemaVersion: 2,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    structuredError: { code: "BILLING_LEAKAGE" },
    ...overrides,
  } as PendingSync;
}

function stateWithFailure(failingItem: PendingSync): MockSyncState {
  return {
    pendingCount: 0,
    failedCount: 1,
    isSyncing: false,
    isCircuitOpen: false,
    triggerSync: vi.fn(),
    deadLetterItems: [failingItem],
    retryableFailedItems: [],
  };
}

beforeEach(() => {
  mockSyncState = stateWithFailure(row({ status: "dead" }));
});

afterEach(() => cleanup());

describe("SyncStatusBanner — re-shows on a distinct failure signature (T-36 · R-SY-02)", () => {
  it("dismissing the current failure hides the banner", () => {
    render(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays hidden for an IDENTICAL signature (same kind + same resource) across re-renders", () => {
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    // Same (syncErrorKind, targetResource) — different queue-row id/retries.
    mockSyncState = stateWithFailure(
      row({ status: "dead", retries: 6, updatedAt: new Date("2026-07-01T00:05:00Z") }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("re-shows when the error KIND differs (same target resource)", () => {
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    mockSyncState = stateWithFailure(
      row({
        status: "dead",
        structuredError: { code: "VALIDATION_FAILED" },
        endpoint: "/api/dispense-events",
      }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("re-shows when the target RESOURCE differs (same error kind)", () => {
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    mockSyncState = stateWithFailure(
      row({
        status: "dead",
        structuredError: { code: "BILLING_LEAKAGE" },
        endpoint: "/api/equipment/eq-9/checkout",
      }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("a distinct signature (differing in BOTH fields) re-shows the banner", () => {
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    mockSyncState = stateWithFailure(
      row({
        status: "dead",
        structuredError: { code: "VALIDATION_FAILED" },
        endpoint: "/api/equipment/eq-9/checkout",
      }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("re-dismissing the new signature hides it again, independent of the first dismissal", () => {
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));

    mockSyncState = stateWithFailure(
      row({ status: "dead", structuredError: { code: "VALIDATION_FAILED" } }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    // Re-render with the SAME (new) signature — stays hidden too.
    rerender(<SyncStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * T-36 review CRITICAL (collision) — `structuredError` is DEAD in the real
 * dead-letter path: retry-exhaustion (network/timeout/5xx,
 * src/lib/sync-engine.ts:302-309) sets `errorMessage` to the FIXED template
 * string `"Failed after 5 attempts"` and never sets `structuredError`. Two
 * DISTINCT queued operations against the SAME endpoint therefore produced the
 * IDENTICAL `(syncErrorKind, targetResource)` signature — dismissing one
 * masked the other, unrelated failure for the rest of the session. The fix
 * folds `clientMutationId` (stable across retries of the SAME row, unique per
 * distinct queued operation) into the signature.
 */
describe("SyncStatusBanner — clientMutationId disambiguates dead-letter collisions (T-36 review Critical)", () => {
  function deadLetterRow(overrides: Partial<PendingSync> = {}): PendingSync {
    return row({
      status: "dead",
      structuredError: null,
      errorMessage: "Failed after 5 attempts",
      endpoint: "/api/equipment/eq-9/return",
      ...overrides,
    });
  }

  it("re-shows for a DIFFERENT clientMutationId sharing the same generic error text + endpoint", () => {
    mockSyncState = stateWithFailure(deadLetterRow({ clientMutationId: "m1" }));
    const { rerender } = render(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    // A DIFFERENT queued operation — same generic errorMessage + endpoint,
    // structuredError still never set — must NOT collide with the first.
    mockSyncState = stateWithFailure(deadLetterRow({ clientMutationId: "m2" }));
    rerender(<SyncStatusBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("stays hidden across retries of the SAME row (same clientMutationId, same errorMessage/endpoint)", () => {
    mockSyncState = stateWithFailure(deadLetterRow({ clientMutationId: "m1" }));
    const { rerender } = render(<SyncStatusBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();

    // Same queued operation, further along in its retry history.
    mockSyncState = stateWithFailure(
      deadLetterRow({
        clientMutationId: "m1",
        retries: 6,
        updatedAt: new Date("2026-07-01T00:05:00Z"),
      }),
    );
    rerender(<SyncStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
