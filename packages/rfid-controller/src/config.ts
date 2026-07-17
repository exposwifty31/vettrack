import { readFileSync } from "node:fs";

import { RFID_LIMITS } from "./contract";

/**
 * Module 9 — configuration. Everything a site survey tunes is config, not code:
 * origin, clinic, aggregation windows, and caps. Secrets are deliberately NOT
 * part of config (a config file can be committed) — they come from env via
 * `secretFromEnv` / a `SecretSource`.
 */
export interface ControllerConfig {
  apiOrigin: string;
  clinicId: string;
  controllerVersion?: string;
  /** Debounce window collapsing same tag+gateway repeat reads. */
  debounceMs: number;
  /** Max movement events per batch — must not exceed the ingest's 200. */
  maxEventsPerBatch: number;
  /** Bounded FIFO retry-buffer cap (5xx/network). */
  bufferCap: number;
  /** POSTs/min ceiling — must not exceed the ingest's 120. */
  rateLimitPerMinute: number;
}

export const DEFAULT_CONFIG = {
  debounceMs: 2_000,
  maxEventsPerBatch: RFID_LIMITS.maxEventsPerBatch,
  bufferCap: 10_000,
  rateLimitPerMinute: RFID_LIMITS.maxRequestsPerMinute,
} as const;

export type ControllerConfigInput = Partial<ControllerConfig> &
  Pick<ControllerConfig, "apiOrigin" | "clinicId">;

export function loadConfig(input: ControllerConfigInput): ControllerConfig {
  // loadConfigFromFile feeds untyped JSON through the ControllerConfigInput cast,
  // so a string field may arrive as a number, array, or object. Reject non-string
  // values here with a contextual error — a numeric/array apiOrigin/clinicId would
  // otherwise throw a bare `.trim()` TypeError, and a non-string controllerVersion
  // would reach the wire contract unchecked.
  for (const name of ["apiOrigin", "clinicId", "controllerVersion"] as const) {
    const value = input[name];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`config: ${name} must be a string`);
    }
  }

  const apiOrigin = (input.apiOrigin ?? "").trim();
  const clinicId = (input.clinicId ?? "").trim();
  if (!apiOrigin) throw new Error("config: apiOrigin is required");
  if (!clinicId) throw new Error("config: clinicId is required");

  const debounceMs = input.debounceMs ?? DEFAULT_CONFIG.debounceMs;
  const maxEventsPerBatch = input.maxEventsPerBatch ?? DEFAULT_CONFIG.maxEventsPerBatch;
  const bufferCap = input.bufferCap ?? DEFAULT_CONFIG.bufferCap;
  const rateLimitPerMinute = input.rateLimitPerMinute ?? DEFAULT_CONFIG.rateLimitPerMinute;

  // loadConfigFromFile feeds untyped JSON through the ControllerConfigInput cast,
  // so a field may arrive as NaN, Infinity, a numeric string, or an array. Reject
  // any non-integer here: NaN/Infinity would silently pass every range comparison
  // below (and NaN maxEventsPerBatch makes the aggregator loop non-terminating).
  for (const [name, value] of [
    ["debounceMs", debounceMs],
    ["maxEventsPerBatch", maxEventsPerBatch],
    ["bufferCap", bufferCap],
    ["rateLimitPerMinute", rateLimitPerMinute],
  ] as const) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`config: ${name} must be an integer`);
    }
  }

  if (debounceMs < 0) throw new Error("config: debounceMs must be >= 0");
  if (maxEventsPerBatch < 1 || maxEventsPerBatch > RFID_LIMITS.maxEventsPerBatch) {
    throw new Error(`config: maxEventsPerBatch must be 1..${RFID_LIMITS.maxEventsPerBatch}`);
  }
  if (rateLimitPerMinute < 1 || rateLimitPerMinute > RFID_LIMITS.maxRequestsPerMinute) {
    throw new Error(`config: rateLimitPerMinute must be 1..${RFID_LIMITS.maxRequestsPerMinute}`);
  }
  if (bufferCap < 1) throw new Error("config: bufferCap must be >= 1");

  return {
    apiOrigin,
    clinicId,
    ...(input.controllerVersion !== undefined ? { controllerVersion: input.controllerVersion } : {}),
    debounceMs,
    maxEventsPerBatch,
    bufferCap,
    rateLimitPerMinute,
  };
}

export function loadConfigFromFile(path: string): ControllerConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`config: ${path} is not a JSON object`);
  }
  return loadConfig(parsed as ControllerConfigInput);
}
