/**
 * Shared mock scaffolding for EquipmentActions tests (CodeRabbit #20, P2
 * review) — extracted from tests/equipment-actions.test.tsx and
 * tests/equipment-actions-unified-return.test.tsx, which duplicated this
 * `vi.mock` setup verbatim.
 *
 * Import this module FIRST (before any other local import) in a test file so
 * Vitest's mock hoisting registers these mocks before EquipmentActions (and
 * its transitive @/lib/api import) is loaded.
 *
 * `authState`/`shiftState` are mutable wrapper objects (not reassignable
 * `let` bindings) because ES module named imports are read-only live
 * bindings in the consuming file — a test file can mutate
 * `authState.value = {...}` but cannot do `authValue = {...}` on an
 * imported binding.
 */
import { vi } from "vitest";

export const returnMock = vi.fn();
export const checkoutMock = vi.fn();
export const listDocksMock = vi.fn();
export const listConditionsMock = vi.fn();
export const conditionStatesMock = vi.fn();
export const dockReturnMock = vi.fn();
export const toastSuccess = vi.fn();
export const toastError = vi.fn();
export const toastInfo = vi.fn();

export type AuthValue = { userId: string | null; isAdmin: boolean };
export type ShiftValue = { hasActiveShift: boolean; isLoading: boolean; isError: boolean; nextShift: null };

export const DEFAULT_AUTH_VALUE: AuthValue = { userId: "admin-1", isAdmin: true };
export const DEFAULT_SHIFT_VALUE: ShiftValue = {
  hasActiveShift: true,
  isLoading: false,
  isError: false,
  nextShift: null,
};

export const authState: { value: AuthValue } = { value: { ...DEFAULT_AUTH_VALUE } };
export const shiftState: { value: ShiftValue } = { value: { ...DEFAULT_SHIFT_VALUE } };

/** Resets mock call history AND auth/shift state back to defaults — call from beforeEach. */
export function resetEquipmentActionsMocks(): void {
  vi.clearAllMocks();
  authState.value = { ...DEFAULT_AUTH_VALUE };
  shiftState.value = { ...DEFAULT_SHIFT_VALUE };
}

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authState.value }));
vi.mock("@/hooks/use-active-shift", () => ({ useActiveShift: () => shiftState.value }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        return: (...a: unknown[]) => returnMock(...a),
        checkout: (...a: unknown[]) => checkoutMock(...a),
      },
      operationalState: {
        ...actual.api.operationalState,
        listDocks: (...a: unknown[]) => listDocksMock(...a),
        listConditions: (...a: unknown[]) => listConditionsMock(...a),
        conditionStates: (...a: unknown[]) => conditionStatesMock(...a),
        dockReturn: (...a: unknown[]) => dockReturnMock(...a),
      },
    },
    // Simplified test-local stand-in: only .message + instanceof matter here,
    // not the real (status, message, payload) constructor shape.
    ApiError: class ApiError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ApiError";
      }
    },
  };
});
