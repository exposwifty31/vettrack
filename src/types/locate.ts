/**
 * Equipment locate search — read-only response types (T-22b · R-EQ-F1).
 * Mirrors server/routes/equipment-locate.ts, which composes the location +
 * custodian evidence resolvers for every clinic-scoped equipment row matching
 * `q`. No imports from ./index.ts.
 */
import type { CopilotClaim } from "../../shared/contracts/asset-copilot.v1.js";

export interface EquipmentLocateResult {
  equipmentId: string;
  name: string;
  location: {
    summary: string;
    claims: CopilotClaim[];
    unknowns: string[];
  };
  custodian: {
    claims: CopilotClaim[];
    unknowns: string[];
    lastCorroboratedAt: string | null;
  };
  readiness: string;
}

export interface EquipmentLocateResponse {
  query: string;
  results: EquipmentLocateResult[];
}
