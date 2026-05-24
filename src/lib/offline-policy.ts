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

export type OfflineSyncUnregisteredPayload = {
  code: typeof OFFLINE_SYNC_UNREGISTERED_CODE;
  pendingType: string;
  endpoint: string;
  method: string;
};

export type PendingSyncEnqueueOp = {
  type: string;
  endpoint: string;
  method: string;
};

/** Thrown when an enqueue is not registered in the offline mutation registry (Phase 2). */
export class UnknownOfflineMutationError extends Error {
  readonly payload: OfflineSyncUnregisteredPayload;

  constructor(payload: OfflineSyncUnregisteredPayload) {
    super(
      `Unregistered offline mutation (${payload.method} ${payload.pendingType} ${payload.endpoint})`,
    );
    this.name = "UnknownOfflineMutationError";
    this.payload = payload;
  }
}

export function buildOfflineSyncUnregisteredPayload(
  op: PendingSyncEnqueueOp,
): OfflineSyncUnregisteredPayload {
  return {
    code: OFFLINE_SYNC_UNREGISTERED_CODE,
    pendingType: op.type,
    endpoint: op.endpoint,
    method: op.method.toUpperCase(),
  };
}

/**
 * Single choke-point policy gate for `addPendingSync`.
 * Emergency reject via existing classifier; allow passes through; unknown throws.
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

  throw new UnknownOfflineMutationError(buildOfflineSyncUnregisteredPayload(op));
}
