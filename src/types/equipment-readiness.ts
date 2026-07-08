// Client-facing equipment readiness governance types (Phase 7c). The rules shape +
// edit bounds live in shared/ (server is authoritative); re-exported for src/types.
export type { EquipmentReadinessRulesV1 } from "../../shared/equipment-readiness-rules.js";
export {
  MIN_STALE_EVIDENCE_MS,
  MAX_STALE_EVIDENCE_MS,
  isValidStaleEvidenceMs,
} from "../../shared/equipment-readiness-rules.js";
