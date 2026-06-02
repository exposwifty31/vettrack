/**
 * Equipment Truth Card API contract.
 * Combines deployability, location, and custodian resolvers with shared citations.
 */

import type { Citation, CopilotClaim } from "./contracts/asset-copilot.v1.js";
import { ASSET_COPILOT_RESOLVER_VERSION } from "./contracts/asset-copilot.v1.js";

export { ASSET_COPILOT_RESOLVER_VERSION };

export interface EquipmentTruthBundleGate {
  ok: boolean;
  reason?: string;
  failedConditions?: string[];
  staleConditions?: string[];
  unknownConditions?: string[];
}

export interface EquipmentTruthResponse {
  equipmentId: string;
  resolverVersion: typeof ASSET_COPILOT_RESOLVER_VERSION;
  asOfMs: number;
  location: {
    summary: string;
    claims: CopilotClaim[];
    unknowns: string[];
  };
  deployability: {
    fullDeployable: boolean;
    custodyState: string;
    readinessState: string;
    usageState: string;
    bundleGate: EquipmentTruthBundleGate;
    claims: CopilotClaim[];
    unknowns: string[];
  };
  custodian: {
    claims: CopilotClaim[];
    unknowns: string[];
    lastCorroboratedAt: string | null;
  };
  citations: Citation[];
}
