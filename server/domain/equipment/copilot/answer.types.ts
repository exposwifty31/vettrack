import type { BundleReadinessResult } from "../../../services/equipment-operational-state.service.js";

/** Normalized deployability — semantic parity with GET /equipment/:id/deployability */
export interface DeployabilityResolverResult {
  equipmentId: string;
  custodyState: string;
  readinessState: string;
  usageState: string;
  fullDeployable: boolean;
  bundleGate: BundleReadinessResult;
  asOfMs: number;
  claims: import("../../../../shared/contracts/asset-copilot.v1.js").CopilotClaim[];
  unknowns: string[];
  citations: import("../../../../shared/contracts/asset-copilot.v1.js").Citation[];
}

export interface LocationResolverResult {
  equipmentId: string;
  summary: string;
  claims: import("../../../../shared/contracts/asset-copilot.v1.js").CopilotClaim[];
  unknowns: string[];
  citations: import("../../../../shared/contracts/asset-copilot.v1.js").Citation[];
}

export interface CustodianResolverResult {
  equipmentId: string;
  claims: import("../../../../shared/contracts/asset-copilot.v1.js").CopilotClaim[];
  unknowns: string[];
  citations: import("../../../../shared/contracts/asset-copilot.v1.js").Citation[];
  lastCorroboratedAt: string | null;
}

export interface WaitlistResolverResult {
  equipmentId: string;
  claims: import("../../../../shared/contracts/asset-copilot.v1.js").CopilotClaim[];
  unknowns: string[];
  citations: import("../../../../shared/contracts/asset-copilot.v1.js").Citation[];
}
