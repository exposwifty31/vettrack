import { describe, it, expect } from "vitest";
import {
  computeBundleReadinessGate,
  isEquipmentFullyDeployable,
} from "../../server/services/equipment-operational-state.service.js";
import {
  normalizeDeployabilityForParity,
  resolveDeployability,
} from "../../server/domain/equipment/evidence/resolver/index.js";
import { buildSyntheticEvidenceGraph } from "../../server/domain/equipment/evidence/graph.loader.js";
import type { AssetTypeCondition, UnitConditionState } from "../../server/db.js";

const NOW = new Date("2026-05-29T12:00:00Z");
const CLINIC = "clinic-parity";
const EQ = "eq-parity";

function httpDeployabilityShape(
  custodyState: string,
  readinessState: string,
  usageState: string,
  assetTypeId: string | null,
  conditionStates: UnitConditionState[],
  conditions: AssetTypeCondition[],
) {
  const bundleGate = computeBundleReadinessGate(
    { custodyState, assetTypeId },
    conditionStates,
    conditions,
    NOW,
  );
  const fullDeployable = isEquipmentFullyDeployable(custodyState, readinessState, usageState);
  return {
    equipmentId: EQ,
    custodyState,
    readinessState,
    usageState,
    fullDeployable,
    bundleGate,
  };
}

const FIXTURES: Array<{
  name: string;
  custodyState: string;
  readinessState: string;
  usageState: string;
  assetTypeId: string | null;
  conditions: AssetTypeCondition[];
  states: UnitConditionState[];
}> = [
  {
    name: "fully deployable docked",
    custodyState: "docked",
    readinessState: "ready",
    usageState: "available",
    assetTypeId: "at-1",
    conditions: [
      {
        id: "c1",
        clinicId: CLINIC,
        assetTypeId: "at-1",
        conditionName: "Battery",
        verificationMethod: "visual",
        staleAfterMinutes: 60,
        displayOrder: 0,
        createdAt: NOW,
      },
    ],
    states: [
      {
        id: "s1",
        clinicId: CLINIC,
        equipmentId: EQ,
        conditionId: "c1",
        verified: true,
        verifiedAt: new Date(NOW.getTime() - 5 * 60_000),
        verifiedById: null,
        notes: null,
        updatedAt: NOW,
      },
    ],
  },
  {
    name: "checked out not deployable",
    custodyState: "checked_out",
    readinessState: "ready",
    usageState: "in_use",
    assetTypeId: "at-1",
    conditions: [],
    states: [],
  },
  {
    name: "untracked custody broken",
    custodyState: "untracked",
    readinessState: "unknown",
    usageState: "available",
    assetTypeId: "at-1",
    conditions: [
      {
        id: "c2",
        clinicId: CLINIC,
        assetTypeId: "at-1",
        conditionName: "Cal",
        verificationMethod: "visual",
        staleAfterMinutes: 30,
        displayOrder: 0,
        createdAt: NOW,
      },
    ],
    states: [],
  },
  {
    name: "stale condition",
    custodyState: "docked",
    readinessState: "not_ready",
    usageState: "available",
    assetTypeId: "at-1",
    conditions: [
      {
        id: "c3",
        clinicId: CLINIC,
        assetTypeId: "at-1",
        conditionName: "Sterile",
        verificationMethod: "visual",
        staleAfterMinutes: 30,
        displayOrder: 0,
        createdAt: NOW,
      },
    ],
    states: [
      {
        id: "s3",
        clinicId: CLINIC,
        equipmentId: EQ,
        conditionId: "c3",
        verified: true,
        verifiedAt: new Date(NOW.getTime() - 120 * 60_000),
        verifiedById: null,
        notes: null,
        updatedAt: NOW,
      },
    ],
  },
  {
    name: "no asset type",
    custodyState: "docked",
    readinessState: "unknown",
    usageState: "available",
    assetTypeId: null,
    conditions: [],
    states: [],
  },
  {
    name: "returned custody",
    custodyState: "returned",
    readinessState: "unknown",
    usageState: "available",
    assetTypeId: "at-1",
    conditions: [],
    states: [],
  },
  {
    name: "emergency use",
    custodyState: "docked",
    readinessState: "ready",
    usageState: "emergency_use",
    assetTypeId: null,
    conditions: [],
    states: [],
  },
  {
    name: "staged usage",
    custodyState: "docked",
    readinessState: "ready",
    usageState: "staged",
    assetTypeId: "at-1",
    conditions: [],
    states: [],
  },
  {
    name: "failed verification",
    custodyState: "docked",
    readinessState: "not_ready",
    usageState: "available",
    assetTypeId: "at-1",
    conditions: [
      {
        id: "c4",
        clinicId: CLINIC,
        assetTypeId: "at-1",
        conditionName: "Leak test",
        verificationMethod: "visual",
        staleAfterMinutes: 60,
        displayOrder: 0,
        createdAt: NOW,
      },
    ],
    states: [
      {
        id: "s4",
        clinicId: CLINIC,
        equipmentId: EQ,
        conditionId: "c4",
        verified: false,
        verifiedAt: null,
        verifiedById: null,
        notes: null,
        updatedAt: NOW,
      },
    ],
  },
  {
    name: "procedure bound",
    custodyState: "docked",
    readinessState: "ready",
    usageState: "procedure_bound",
    assetTypeId: "at-1",
    conditions: [],
    states: [],
  },
];

describe("deployability semantic parity", () => {
  for (const fx of FIXTURES) {
    it(`matches HTTP deployability shape: ${fx.name}`, async () => {
      const http = httpDeployabilityShape(
        fx.custodyState,
        fx.readinessState,
        fx.usageState,
        fx.assetTypeId,
        fx.states,
        fx.conditions,
      );

      const graph = buildSyntheticEvidenceGraph({
        clinicId: CLINIC,
        equipmentId: EQ,
        equipment: {
          id: EQ,
          clinicId: CLINIC,
          name: "Device",
          custodyState: fx.custodyState,
          custodyStateSince: NOW,
          checkedOutById: null,
          checkedOutByEmail: null,
          checkedOutAt: null,
          checkedOutLocation: null,
          readinessState: fx.readinessState,
          usageState: fx.usageState,
          assetTypeId: fx.assetTypeId,
          roomId: null,
          dockId: null,
          location: null,
          lastRfidSeenAt: null,
          lastRfidRoomId: null,
          lastSeen: null,
        },
        assetTypeConditions: fx.conditions,
        unitConditionStates: fx.states,
      });

      const resolver = normalizeDeployabilityForParity(
        await resolveDeployability(
          { clinicId: CLINIC, equipmentId: EQ, now: NOW },
          graph,
        ),
      );

      expect(resolver).toEqual({
        equipmentId: http.equipmentId,
        custodyState: http.custodyState,
        readinessState: http.readinessState,
        usageState: http.usageState,
        fullDeployable: http.fullDeployable,
        bundleGate: http.bundleGate,
      });
    });
  }
});
