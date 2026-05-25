import { createHash } from "crypto";

/** Stable JSON for request-hash comparison on offline replay. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashEquipmentReplayRequest(
  method: string,
  path: string,
  body: unknown,
): string {
  const payload = `${method.toUpperCase()}:${path}:${stableStringify(body ?? null)}`;
  return createHash("sha256").update(payload).digest("hex");
}

/** Scope idempotency keys per clinic user so peers cannot replay another actor's result. */
export function buildEquipmentReplayStorageKey(userId: string, headerKey: string): string {
  const uid = userId.trim();
  const key = headerKey.trim();
  return `${uid}:${key}`;
}

export const EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS = {
  create: "POST /api/equipment",
  update: "PATCH /api/equipment/:id",
  delete: "DELETE /api/equipment/:id",
  checkout: "POST /api/equipment/:id/checkout",
  return: "POST /api/equipment/:id/return",
  seen: "POST /api/equipment/:id/seen",
  scan: "POST /api/equipment/:id/scan",
} as const;
