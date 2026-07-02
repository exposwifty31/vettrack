// Lands at: src/dev/mock-app-providers.tsx (adjust the path to wherever the
// team keeps preview/storybook-style harnesses).
// §22-D1 — lets real, data-connected DS components (EquipmentTruthCard,
// ShiftSummarySheet, ...) render with realistic mock data instead of hitting
// the network, for design review / Claude Code implementation checks.
//
// REQUIRES one small real-code change first: src/hooks/use-auth.tsx currently
// defines `const AuthContext = createContext(...)` WITHOUT exporting it. Add
// `export` to that line so this file can provide a mock auth value. Every
// other API used below is already exported.
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
// import { AuthContext } from "@/hooks/use-auth"; // uncomment once exported

export function createMockQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
}

export interface MockUser {
  userId: string;
  email: string;
  name: string;
}

const DEFAULT_MOCK_USER: MockUser = {
  userId: "preview-user",
  email: "maya@vettrack.app",
  name: "Maya Abbas",
};

export interface MockAppProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
  /** Requires AuthContext to be exported from src/hooks/use-auth.tsx — see
   * file header. Until then this prop is accepted but has no effect. */
  mockUser?: MockUser;
}

export function MockAppProviders({
  children,
  queryClient,
  mockUser = DEFAULT_MOCK_USER,
}: MockAppProvidersProps) {
  const client = React.useMemo(
    () => queryClient ?? createMockQueryClient(),
    [queryClient],
  );
  return (
    <QueryClientProvider client={client}>
      <Router>
        {/* <AuthContext.Provider value={{ ...mockUser, isLoading: false }}> */}
        {children}
        {/* </AuthContext.Provider> */}
      </Router>
    </QueryClientProvider>
  );
}

// ---- Seed helpers — pre-populate the cache so useQuery resolves instantly
// with realistic data instead of calling the real `api.*` functions. ----

export interface MockEquipmentTruth {
  location: { summary: string; unknowns: string[] };
  custodian: { claims: { key: string; value: string }[]; unknowns: string[] };
  deployability: {
    custodyState: string;
    readinessState: string;
    usageState: string;
    fullDeployable: boolean;
    bundleGate: { ok: boolean; reason: string | null };
    unknowns: string[];
  };
  citations: unknown[];
}

/**
 * Matches EquipmentTruthCard's real query exactly — verified against
 * src/components/equipment/EquipmentTruthCard.tsx:
 *   useQuery({ queryKey: ["equipment-truth", equipmentId], queryFn: () => api.equipment.truth(equipmentId) })
 * and its actual field access (truth.location.summary, truth.custodian.claims,
 * truth.deployability.{custodyState,readinessState,usageState,fullDeployable,
 * bundleGate}, truth.citations).
 */
export function seedEquipmentTruth(
  client: QueryClient,
  equipmentId: string,
  overrides: Partial<MockEquipmentTruth> = {},
) {
  const base: MockEquipmentTruth = {
    location: { summary: "ICU-2", unknowns: [] },
    custodian: { claims: [{ key: "custodian", value: "Dr. Lee" }], unknowns: [] },
    deployability: {
      custodyState: "checked_out",
      readinessState: "ready",
      usageState: "in_use",
      fullDeployable: true,
      bundleGate: { ok: true, reason: null },
      unknowns: [],
    },
    citations: [],
  };
  client.setQueryData(["equipment-truth", equipmentId], { ...base, ...overrides });
}

/**
 * ShiftSummarySheet reads SIX query keys total (all six now confirmed by
 * grepping the real source — response shapes for the last five are NOT
 * individually verified beyond their key, since that requires reading each
 * render section in turn). Seed all six for a non-empty render; empty
 * arrays/objects are a safe default for anything not overridden.
 */
export function seedShiftSummary(
  client: QueryClient,
  userId: string,
  overrides: {
    myEquipment?: unknown[];
    equipment?: unknown[];
    activity?: unknown[];
    alertAcks?: unknown[];
    homeDashboard?: unknown;
    tasksDashboard?: unknown;
  } = {},
) {
  client.setQueryData(["/api/equipment/my"], overrides.myEquipment ?? []);
  client.setQueryData(["/api/equipment"], overrides.equipment ?? []);
  client.setQueryData(["/api/activity"], overrides.activity ?? []);
  client.setQueryData(["/api/alert-acks"], overrides.alertAcks ?? []);
  client.setQueryData(["/api/home/dashboard"], overrides.homeDashboard ?? {});
  client.setQueryData(["/api/tasks/dashboard", userId], overrides.tasksDashboard ?? {});
}

/**
 * Verified query key AND response shape (read the full render logic in
 * src/components/equipment/OperationalMetricsDashboard.tsx, not just its
 * useQuery call) — takes no props, so it must fetch internally; a real
 * "needs QueryClientProvider" case.
 *
 * IMPORTANT CORRECTION (§26-D1): this does NOT render "asset-type readiness
 * compliance %" as Stage 7's handoff screen assumed. The real metrics are
 * Equipment-Hero/deployability counters: emergencyOverrides, bundleFailures,
 * staleConditions, procedureBounds, averageCheckoutMs, averageDockReturnMs,
 * and an optional deployableSuccessRate (0-1, shown as %). `metricsEnabled:
 * false` short-circuits to a disabled message instead of the grid.
 */
export interface MockOperationalMetricsSummary {
  metricsEnabled?: boolean;
  emergencyOverrides: number;
  bundleFailures: number;
  staleConditions: number;
  procedureBounds: number;
  averageCheckoutMs: number | null;
  averageDockReturnMs: number | null;
  deployableSuccessRate?: number | null;
}

export function seedOperationalMetricsSummary(
  client: QueryClient,
  rangeDays: number,
  overrides: Partial<MockOperationalMetricsSummary> = {},
) {
  const base: MockOperationalMetricsSummary = {
    metricsEnabled: true,
    emergencyOverrides: 2,
    bundleFailures: 1,
    staleConditions: 3,
    procedureBounds: 4,
    averageCheckoutMs: 96_000,
    averageDockReturnMs: 41_000,
    deployableSuccessRate: 0.94,
  };
  client.setQueryData(["/api/operational-metrics/summary", rangeDays], {
    ...base,
    ...overrides,
  });
}

/**
 * Verified (src/components/equipment/WaitlistPanel.tsx): PREFER passing
 * `snapshot` as a prop directly — the component explicitly skips its
 * internal `useQuery(["equipment-waitlist", equipment.id])` fetch when a
 * `snapshot` prop is provided (`enabled: ... && snapshotProp === undefined`).
 * This helper exists only for the case where you deliberately want to
 * exercise the internal-fetch code path instead.
 */
export function seedEquipmentWaitlist(
  client: QueryClient,
  equipmentId: string,
  snapshot: unknown = { position: 0, totalWaiting: 0, entries: [] },
) {
  client.setQueryData(["equipment-waitlist", equipmentId], snapshot);
}

// ---- NOT data-connected — pass props directly, no provider/seeding needed ----
//
// AlertsDropdown (src/components/alerts-dropdown.tsx): confirmed 100%
// presentational — no @tanstack/react-query import at all. Props are
// `alerts`, `alertCount`, `badgeAnimating`. The original bundle README's
// blanket claim that it "expects a TanStack QueryClientProvider" is WRONG for
// this component; correcting that here rather than carrying the mistake
// forward (see README §23).
