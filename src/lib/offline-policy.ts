import {
  classifyEmergencyEndpoint,
  type EmergencyEndpointClass,
} from "@/lib/offline-emergency-block";
import { resolveAllowRegistryEntry } from "@/lib/offline-mutation-registry";

export type OfflinePolicy = "allow" | "block" | "draft-only" | "online-required";

export type ConflictStrategyLabel = "append-only" | "version-check" | "none";

/** Thrown when a Code Blue emergency mutation reaches the offline enqueue choke point. */
export class OfflineEmergencyMutationBlockedError extends Error {
  endpointClass: EmergencyEndpointClass;

  constructor(endpointClass: EmergencyEndpointClass) {
    super(`Offline emergency mutation blocked (${endpointClass})`);
    this.name = "OfflineEmergencyMutationBlockedError";
    this.endpointClass = endpointClass;
  }
}

export const OFFLINE_SYNC_UNREGISTERED_CODE = "OFFLINE_SYNC_UNREGISTERED" as const;

export type PendingSyncEnqueueOp = {
  type: string;
  endpoint: string;
  method: string;
};

/**
 * Phase 1 — single choke-point policy gate for `addPendingSync`.
 * Emergency reject via existing classifier; allow passes through; unknown warns only.
 */
export function assertPendingSyncEnqueueAllowed(op: PendingSyncEnqueueOp): void {
  const method = op.method.toUpperCase();
  const emergencyClass = classifyEmergencyEndpoint(op.endpoint, method);
  if (emergencyClass) {
    throw new OfflineEmergencyMutationBlockedError(emergencyClass);
  }

  if (resolveAllowRegistryEntry({ type: op.type, endpoint: op.endpoint, method })) {
    return;
  }

  console.warn("[offline-policy] unregistered_pending_sync_enqueue", {
    code: OFFLINE_SYNC_UNREGISTERED_CODE,
    type: op.type,
    endpoint: op.endpoint,
    method,
  });
}
