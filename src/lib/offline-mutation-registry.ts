/**
 * Phase 1 — offline mutation registry (audit + enqueue policy resolution).
 * `online-required` entries are documentation-only in Phase 1 (no enqueue reject).
 */

export type ProducerPendingSyncType =
  | "scan"
  | "seen"
  | "create"
  | "update"
  | "delete"
  | "checkout"
  | "return"
  | "return_with_charge";

/** PendingSyncType values with no producer today — resolve in Phase 2. */
export const ORPHAN_PENDING_SYNC_TYPES = ["restock", "shift_session"] as const;

export type AllowRegistryEntry = {
  readonly key: string;
  readonly policy: "allow";
  readonly pendingType: ProducerPendingSyncType;
  readonly method: string;
  readonly pathPattern: RegExp;
  readonly conflictStrategy: "append-only" | "version-check";
};

export type OnlineRequiredRegistryEntry = {
  readonly key: string;
  readonly policy: "online-required";
  readonly reason: string;
  /** Phase 1: must remain false unless explicitly listed under allow producers. */
  readonly hasEnqueueProducer: false;
};

export const offlineAllowProducers: readonly AllowRegistryEntry[] = [
  {
    key: "equipment.create",
    policy: "allow",
    pendingType: "create",
    method: "POST",
    pathPattern: /^\/api\/equipment$/,
    conflictStrategy: "version-check",
  },
  {
    key: "equipment.update",
    policy: "allow",
    pendingType: "update",
    method: "PATCH",
    pathPattern: /^\/api\/equipment\/[^/]+$/,
    conflictStrategy: "version-check",
  },
  {
    key: "equipment.delete",
    policy: "allow",
    pendingType: "delete",
    method: "DELETE",
    pathPattern: /^\/api\/equipment\/[^/]+$/,
    conflictStrategy: "version-check",
  },
  {
    key: "equipment.scan",
    policy: "allow",
    pendingType: "scan",
    method: "POST",
    pathPattern: /^\/api\/equipment\/[^/]+\/scan$/,
    conflictStrategy: "append-only",
  },
  {
    key: "equipment.seen",
    policy: "allow",
    pendingType: "seen",
    method: "POST",
    pathPattern: /^\/api\/equipment\/[^/]+\/seen$/,
    conflictStrategy: "append-only",
  },
  {
    key: "equipment.checkout",
    policy: "allow",
    pendingType: "checkout",
    method: "POST",
    pathPattern: /^\/api\/equipment\/[^/]+\/checkout$/,
    conflictStrategy: "version-check",
  },
  {
    key: "equipment.return",
    policy: "allow",
    pendingType: "return",
    method: "POST",
    pathPattern: /^\/api\/equipment\/[^/]+\/return$/,
    conflictStrategy: "version-check",
  },
  {
    key: "equipment.return_with_charge",
    policy: "allow",
    pendingType: "return_with_charge",
    method: "POST",
    pathPattern: /^\/api\/equipment\/[^/]+\/return$/,
    conflictStrategy: "version-check",
  },
] as const;

export const offlineOnlineRequiredDomains: readonly OnlineRequiredRegistryEntry[] = [
  {
    key: "code_blue.mutations",
    policy: "online-required",
    reason: "Emergency mutations cannot be queued offline (classifyEmergencyEndpoint)",
    hasEnqueueProducer: false,
  },
  {
    key: "medication.complete",
    policy: "online-required",
    reason: "Requires authoritative billing/inventory/clinical state",
    hasEnqueueProducer: false,
  },
  {
    key: "billing.finalization",
    policy: "online-required",
    reason: "Requires authoritative billing state",
    hasEnqueueProducer: false,
  },
  {
    key: "authority.enforcement",
    policy: "online-required",
    reason: "Requires live authority/enforcement decisions",
    hasEnqueueProducer: false,
  },
  {
    key: "dispense",
    policy: "online-required",
    reason: "Requires live clinical and inventory state",
    hasEnqueueProducer: false,
  },
] as const;

function normalizePathname(endpoint: string): string {
  try {
    return new URL(endpoint, "http://localhost").pathname;
  } catch {
    return endpoint.split("?")[0];
  }
}

export function resolveAllowRegistryEntry(op: {
  type: string;
  endpoint: string;
  method: string;
}): AllowRegistryEntry | undefined {
  const pathname = normalizePathname(op.endpoint);
  const method = op.method.toUpperCase();
  return offlineAllowProducers.find(
    (entry) =>
      entry.pendingType === op.type &&
      entry.method === method &&
      entry.pathPattern.test(pathname),
  );
}

/** Every production allow producer type must have a registry row (behavioral coverage). */
export const PRODUCTION_ENQUEUE_PRODUCER_TYPES: readonly ProducerPendingSyncType[] =
  offlineAllowProducers.map((e) => e.pendingType);
