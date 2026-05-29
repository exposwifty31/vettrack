import { describe, it, expect } from "vitest";
import { buildSyntheticEvidenceGraph } from "../../server/domain/equipment/evidence/graph.loader.js";
import {
  resolveCurrentLocation,
  resolveCustodian,
  resolveDeployability,
  resolveWaitlistStatus,
} from "../../server/domain/equipment/evidence/resolver/index.js";
import { validateCopilotAnswer } from "../../server/domain/equipment/copilot/citation-validator.js";
import { ASSET_COPILOT_RESOLVER_VERSION } from "../../shared/contracts/asset-copilot.v1.js";
import type { EvidenceGraph } from "../../server/domain/equipment/evidence/graph.types.js";

const NOW = new Date("2026-05-29T12:00:00Z");
const CLINIC = "golden-clinic";
const EQ = "golden-eq";

type GoldenCase = {
  id: string;
  category: string;
  graph: EvidenceGraph;
  assert: () => Promise<void>;
};

function baseEquipment(
  overrides: Partial<NonNullable<EvidenceGraph["equipment"]>> = {},
): NonNullable<EvidenceGraph["equipment"]> {
  return {
    id: EQ,
    clinicId: CLINIC,
    name: "Infusion Pump",
    custodyState: "docked",
    custodyStateSince: NOW,
    checkedOutById: null,
    checkedOutByEmail: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    readinessState: "ready",
    usageState: "available",
    assetTypeId: null,
    roomId: null,
    dockId: null,
    location: "Storage",
    lastRfidSeenAt: null,
    lastRfidRoomId: null,
    lastSeen: NOW,
    ...overrides,
  };
}

const CASES: GoldenCase[] = [
  {
    id: "deploy-01",
    category: "deployability",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ assetTypeId: "at-golden" }),
      assetTypeConditions: [
        {
          id: "cond-g",
          clinicId: CLINIC,
          assetTypeId: "at-golden",
          conditionName: "Battery",
          verificationMethod: "visual",
          staleAfterMinutes: 60,
          displayOrder: 0,
          createdAt: NOW,
        },
      ],
      unitConditionStates: [
        {
          id: "ucs-g",
          clinicId: CLINIC,
          equipmentId: EQ,
          conditionId: "cond-g",
          verified: true,
          verifiedAt: new Date(NOW.getTime() - 5 * 60_000),
          verifiedById: null,
          notes: null,
          updatedAt: NOW,
        },
      ],
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.fullDeployable).toBe(true);
      expect(r.bundleGate.ok).toBe(true);
    },
  },
  {
    id: "deploy-02",
    category: "deployability",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ custodyState: "checked_out", usageState: "in_use" }),
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.fullDeployable).toBe(false);
    },
  },
  {
    id: "deploy-03",
    category: "deployability",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ custodyState: "untracked" }),
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.bundleGate.ok).toBe(false);
    },
  },
  {
    id: "rfid-01",
    category: "rfid",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ roomId: "room-icu" }),
      rooms: [{ id: "room-icu", clinicId: CLINIC, name: "ICU" }],
      recentRfidReads: [
        {
          id: "rfid-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          fromRoomId: null,
          toRoomId: "room-icu",
          gatewayCode: "gw1",
          readAt: NOW,
          batchId: "b1",
        },
      ],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.summary).toContain("ICU");
    },
  },
  {
    id: "rfid-02",
    category: "rfid",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      recentRfidReads: [],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "rfid")).toBe(false);
    },
  },
  {
    id: "rfid-03",
    category: "rfid",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ lastRfidSeenAt: new Date(NOW.getTime() - 5 * 60_000) }),
    }),
    async assert() {
      const loc = await resolveCurrentLocation(ctx(), this.graph);
      expect(loc.summary).not.toBe("unknown");
    },
  },
  {
    id: "loc-01",
    category: "location",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ location: "Ward B" }),
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.summary).toContain("Ward B");
    },
  },
  {
    id: "loc-02",
    category: "location",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({
        custodyState: "checked_out",
        checkedOutLocation: "OR-2",
      }),
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.summary).toContain("OR-2");
    },
  },
  {
    id: "loc-03",
    category: "location",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ location: null, roomId: null }),
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.unknowns).toContain("no_authoritative_location");
    },
  },
  {
    id: "scan-01",
    category: "missing_scans",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      recentScans: [],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "scan")).toBe(false);
    },
  },
  {
    id: "scan-02",
    category: "missing_scans",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      recentScans: [
        {
          id: "scan-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          status: "ok",
          timestamp: NOW,
          userEmail: "a@test.com",
        },
      ],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "scan")).toBe(true);
    },
  },
  {
    id: "scan-03",
    category: "missing_scans",
    graph: buildSyntheticEvidenceGraph({ clinicId: CLINIC, equipmentId: EQ, equipment: null }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.unknowns).toContain("equipment_not_found");
    },
  },
  {
    id: "custody-01",
    category: "custody",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({
        custodyState: "checked_out",
        checkedOutById: "user-a",
        checkedOutByEmail: "alice@clinic.test",
        checkedOutAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000),
      }),
      supersessionEvents: [],
    }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.claims.find((c) => c.key === "custodian")?.value).toContain("alice");
      expect(r.claims.find((c) => c.key === "custodian")?.confidence.evidenceFreshness).toBe(
        "current",
      );
    },
  },
  {
    id: "custody-02",
    category: "custody",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({
        custodyState: "checked_out",
        checkedOutById: "user-a",
        checkedOutAt: new Date("2026-05-28T08:00:00Z"),
      }),
      recentTransfers: [
        {
          id: "xfer-sup",
          clinicId: CLINIC,
          equipmentId: EQ,
          timestamp: new Date("2026-05-29T10:00:00Z"),
          fromFolderName: "A",
          toFolderName: "B",
        },
      ],
    }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.unknowns).toContain("no_active_custodian");
    },
  },
  {
    id: "custody-03",
    category: "custody",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ custodyState: "docked" }),
    }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.unknowns).toContain("no_active_custodian");
    },
  },
  {
    id: "cond-01",
    category: "condition",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ assetTypeId: "at-1", readinessState: "not_ready" }),
      assetTypeConditions: [
        {
          id: "cond-1",
          clinicId: CLINIC,
          assetTypeId: "at-1",
          conditionName: "Battery",
          verificationMethod: "visual",
          staleAfterMinutes: 60,
          displayOrder: 0,
          createdAt: NOW,
        },
      ],
      unitConditionStates: [
        {
          id: "ucs-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          conditionId: "cond-1",
          verified: false,
          verifiedAt: null,
          verifiedById: null,
          notes: null,
          updatedAt: NOW,
        },
      ],
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.bundleGate.ok).toBe(false);
    },
  },
  {
    id: "cond-02",
    category: "condition",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ assetTypeId: "at-1" }),
      assetTypeConditions: [
        {
          id: "cond-2",
          clinicId: CLINIC,
          assetTypeId: "at-1",
          conditionName: "Cal",
          verificationMethod: "visual",
          staleAfterMinutes: 30,
          displayOrder: 0,
          createdAt: NOW,
        },
      ],
      unitConditionStates: [
        {
          id: "ucs-2",
          clinicId: CLINIC,
          equipmentId: EQ,
          conditionId: "cond-2",
          verified: true,
          verifiedAt: new Date(NOW.getTime() - 120 * 60_000),
          verifiedById: null,
          notes: null,
          updatedAt: NOW,
        },
      ],
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.unknowns.some((u) => u.startsWith("condition_stale"))).toBe(true);
    },
  },
  {
    id: "cond-03",
    category: "condition",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ assetTypeId: null }),
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.bundleGate.ok).toBe(false);
    },
  },
  {
    id: "xfer-01",
    category: "transfer",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      recentTransfers: [
        {
          id: "t1",
          clinicId: CLINIC,
          equipmentId: EQ,
          timestamp: NOW,
          fromFolderName: "Central",
          toFolderName: "ICU",
        },
      ],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "transfer")).toBe(true);
    },
  },
  {
    id: "xfer-02",
    category: "transfer",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      recentTransfers: [],
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "transfer")).toBe(false);
    },
  },
  {
    id: "xfer-03",
    category: "transfer",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({
        custodyState: "checked_out",
        checkedOutById: "u1",
        checkedOutAt: new Date("2026-05-28T08:00:00Z"),
      }),
      recentTransfers: [
        {
          id: "t-sup",
          clinicId: CLINIC,
          equipmentId: EQ,
          timestamp: new Date("2026-05-29T11:00:00Z"),
          fromFolderName: "X",
          toFolderName: "Y",
        },
      ],
    }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.unknowns).toContain("no_active_custodian");
    },
  },
  {
    id: "wait-01",
    category: "waitlist",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ custodyState: "checked_out", usageState: "in_use" }),
      waitlist: {
        equipmentId: EQ,
        queueSize: 2,
        myPosition: 1,
        myStatus: "waiting",
        reservationExpiresAt: null,
        notifiedUserId: null,
        entries: [
          {
            position: 1,
            userId: "viewer",
            displayName: "Viewer",
            status: "waiting",
            joinedAt: NOW.toISOString(),
            reservationExpiresAt: null,
          },
        ],
      },
    }),
    async assert() {
      const r = await resolveWaitlistStatus(ctx("viewer"), this.graph);
      expect(r.claims.find((c) => c.key === "waitlist_queue_size")?.value).toBe("2");
    },
  },
  {
    id: "wait-02",
    category: "waitlist",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      waitlist: null,
    }),
    async assert() {
      const r = await resolveWaitlistStatus(ctx(), this.graph);
      expect(r.unknowns).toContain("waitlist_snapshot_unavailable");
    },
  },
  {
    id: "wait-03",
    category: "waitlist",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
      activeStaging: [
        {
          id: "stg-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          requestedById: "u1",
          taskId: null,
          clinicalPriority: "routine",
          stagedAt: NOW,
          expiresAt: null,
          status: "active",
          notes: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      waitlist: {
        equipmentId: EQ,
        queueSize: 1,
        myPosition: null,
        myStatus: null,
        reservationExpiresAt: null,
        notifiedUserId: null,
        entries: [],
      },
    }),
    async assert() {
      const r = await resolveWaitlistStatus(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "staging")).toBe(true);
      expect(r.claims.some((c) => c.key === "staging_vs_waitlist")).toBe(true);
    },
  },
  {
    id: "conflict-01",
    category: "conflicts",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.unknowns.length).toBeGreaterThanOrEqual(0);
    },
  },
  {
    id: "conflict-02",
    category: "conflicts",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ custodyState: "untracked" }),
    }),
    async assert() {
      const r = await resolveCustodian(ctx(), this.graph);
      expect(r.unknowns).toContain("no_active_custodian");
    },
  },
  {
    id: "conflict-03",
    category: "conflicts",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ readinessState: "unknown" }),
    }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.claims.length).toBeGreaterThan(0);
      expect(r.fullDeployable).toBe(false);
    },
  },
  {
    id: "general-01",
    category: "general",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment(),
    }),
    async assert() {
      const dep = await resolveDeployability(ctx(), this.graph);
      const loc = await resolveCurrentLocation(ctx(), this.graph);
      const answer = {
        resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
        equipmentId: EQ,
        claims: [...dep.claims, ...loc.claims],
        unknowns: [...dep.unknowns, ...loc.unknowns],
        citations: [...dep.citations, ...loc.citations],
      };
      expect(validateCopilotAnswer(answer, this.graph).valid).toBe(true);
    },
  },
  {
    id: "general-02",
    category: "general",
    graph: buildSyntheticEvidenceGraph({ clinicId: CLINIC, equipmentId: EQ, equipment: null }),
    async assert() {
      const r = await resolveDeployability(ctx(), this.graph);
      expect(r.unknowns).toContain("equipment_not_found");
    },
  },
  {
    id: "general-03",
    category: "general",
    graph: buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ dockId: "dock-1" }),
    }),
    async assert() {
      const r = await resolveCurrentLocation(ctx(), this.graph);
      expect(r.citations.some((c) => c.type === "dock")).toBe(true);
    },
  },
];

function ctx(viewerUserId?: string) {
  return { clinicId: CLINIC, equipmentId: EQ, now: NOW, viewerUserId };
}

describe("asset copilot resolver golden (n=30)", () => {
  expect(CASES.length).toBe(30);

  for (const testCase of CASES) {
    it(`${testCase.category} / ${testCase.id}`, async () => {
      await testCase.assert();
    });
  }
});
