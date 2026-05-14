/**
 * Phase 2.5 PR 5.3 — operationalRole shadow re-validation.
 *
 * SHADOW ONLY. This module never mutates the authority snapshot, never blocks
 * the resolver hot path, never writes to the audit log, and never throws back
 * into the caller. Its sole purpose is to observe drift between a snapshot's
 * operationalRole and the user's current allowed_operational_roles allowlist.
 *
 * Strict synchronous guard ordering: feature flag → non-null operationalRole
 * → per-tuple dedupe → process-wide token bucket. A suppressed call does NOT
 * allocate a Promise; the runner function is only referenced as a callable
 * after all four guards have passed.
 *
 * Reader contract is three-state: null = user missing, [] = exists with empty
 * allowlist (flows through normal drift evaluation), [...] = membership check.
 */

import { and, eq } from "drizzle-orm";
import { db, users } from "../db.js";
import { createLogLimiter } from "./log-safety.js";
import { incrementMetric } from "./metrics.js";

export interface OperationalRoleShadowArgs {
  clinicId: string;
  userId: string;
  observedOperationalRole: string | null;
  checkInId: string;
  resolvedAt: string;
}

export type AllowlistReader = (input: {
  clinicId: string;
  userId: string;
}) => Promise<string[] | null>;

async function defaultAllowlistReader(input: {
  clinicId: string;
  userId: string;
}): Promise<string[] | null> {
  const rows = await db
    .select({ allowed: users.allowedOperationalRoles })
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.clinicId, input.clinicId)))
    .limit(1);
  if (rows.length === 0) return null;
  const raw = rows[0].allowed;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

let currentReader: AllowlistReader = defaultAllowlistReader;

export function __setAllowlistReaderForTests(reader: AllowlistReader | null): void {
  currentReader = reader ?? defaultAllowlistReader;
}

// ---------------------------------------------------------------------------
// Guard 3 dedupe: per-tuple "last dispatched at" map. Custom (not
// createLogLimiter) so peek and commit can be separated — the dedupe slot is
// only consumed when the runner actually dispatches. Without this split, a
// call that passes dedupe but then loses the token-bucket race would burn the
// dedupe slot for 5 minutes and silently suppress all subsequent observations
// of that tuple.
// ---------------------------------------------------------------------------
const DEDUPE_WINDOW_MS = 300_000;
const DEDUPE_MAX_ENTRIES = 500;
let shadowDedupeMap = new Map<string, number>();

function dedupePeekShouldRun(key: string): boolean {
  const last = shadowDedupeMap.get(key);
  return last === undefined || Date.now() - last >= DEDUPE_WINDOW_MS;
}

function dedupeCommit(key: string): void {
  // Only evict when a *new* key would push us over capacity. Re-committing
  // an existing key doesn't grow the map, so evicting would just drop a
  // valid entry for no reason.
  if (
    shadowDedupeMap.size >= DEDUPE_MAX_ENTRIES &&
    !shadowDedupeMap.has(key)
  ) {
    const oldest = shadowDedupeMap.keys().next().value;
    if (oldest !== undefined) shadowDedupeMap.delete(oldest);
  }
  // delete-then-set so the key moves to the end of the Map's insertion
  // order on every commit. Without the delete, Map.set on an existing key
  // leaves the key in its original position, making eviction FIFO instead
  // of LRU.
  shadowDedupeMap.delete(key);
  shadowDedupeMap.set(key, Date.now());
}

// ---------------------------------------------------------------------------
// Limiters. Declared `let` so __resetLimitersForTests can recreate them,
// since createLogLimiter exposes no public reset.
// ---------------------------------------------------------------------------
let shadowDriftLogLimiter = createLogLimiter({
  dedupeWindowMs: 300_000,
  sampleRate: 1,
  maxEntries: 500,
});

let shadowRunnerErrorLogLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

export function __resetLimitersForTests(): void {
  shadowDedupeMap = new Map();
  shadowDriftLogLimiter = createLogLimiter({
    dedupeWindowMs: 300_000,
    sampleRate: 1,
    maxEntries: 500,
  });
  shadowRunnerErrorLogLimiter = createLogLimiter({
    dedupeWindowMs: 60_000,
    sampleRate: 1,
    maxEntries: 200,
  });
}

// ---------------------------------------------------------------------------
// Guard 4: in-process token bucket (200/min default).
// ---------------------------------------------------------------------------
const DEFAULT_TOKEN_BUCKET_CEILING = 200;
const TOKEN_BUCKET_WINDOW_MS = 60_000;

interface TokenBucket {
  tryConsume(): boolean;
  /** Test-only: override the ceiling. */
  __setCeilingForTests(ceiling: number): void;
  /** Test-only: reset window + counter. */
  __resetForTests(): void;
}

function createTokenBucket(initialCeiling: number): TokenBucket {
  let ceiling = initialCeiling;
  let windowStart = Date.now();
  let consumed = 0;
  return {
    tryConsume(): boolean {
      const now = Date.now();
      if (now - windowStart >= TOKEN_BUCKET_WINDOW_MS) {
        windowStart = now;
        consumed = 0;
      }
      if (consumed >= ceiling) return false;
      consumed += 1;
      return true;
    },
    __setCeilingForTests(next: number): void {
      ceiling = next;
    },
    __resetForTests(): void {
      windowStart = Date.now();
      consumed = 0;
    },
  };
}

const shadowTokenBucket = createTokenBucket(DEFAULT_TOKEN_BUCKET_CEILING);

export function __setTokenBucketCeilingForTests(ceiling: number): void {
  shadowTokenBucket.__setCeilingForTests(ceiling);
}

export function __resetTokenBucketForTests(): void {
  shadowTokenBucket.__resetForTests();
}

// ---------------------------------------------------------------------------
// Test-only seam: spy the runner without mocking the entire module.
// ---------------------------------------------------------------------------
let runnerOverride: ((args: OperationalRoleShadowArgs) => Promise<void>) | null =
  null;

export function __setRunnerOverrideForTests(
  runner: ((args: OperationalRoleShadowArgs) => Promise<void>) | null,
): void {
  runnerOverride = runner;
}

// ---------------------------------------------------------------------------
// Public: synchronous scheduler. Returns void. Allocates a detached Promise
// only after all four guards pass.
// ---------------------------------------------------------------------------
export function scheduleOperationalRoleShadowValidation(
  args: OperationalRoleShadowArgs,
): void {
  // Guard 1: feature flag.
  if (process.env.AUTHORITY_OPROLE_SHADOW !== "true") return;

  // Guard 2: nothing to compare against the allowlist.
  if (!args.observedOperationalRole) return;

  // Guard 3: per-(clinic,user,operationalRole) dedupe — PEEK ONLY.
  // We do NOT mark the key here; that happens after guard 4 also passes,
  // so a throttled call doesn't burn its dedupe slot.
  const dedupeKey = `${args.clinicId}:${args.userId}:${args.observedOperationalRole}`;
  if (!dedupePeekShouldRun(dedupeKey)) {
    incrementMetric("authority_oprole_shadow_deduped");
    return;
  }

  // Guard 4: process-wide token bucket.
  if (!shadowTokenBucket.tryConsume()) {
    incrementMetric("authority_oprole_shadow_throttled");
    return;
  }

  // Both guards passed — commit the dedupe slot now that we're actually
  // dispatching the runner.
  dedupeCommit(dedupeKey);

  incrementMetric("authority_oprole_shadow_scheduled");

  const runner = runnerOverride ?? runShadowValidation;
  void runner(args).catch((err: unknown) => {
    incrementMetric("authority_oprole_shadow_runner_failed");
    if (shadowRunnerErrorLogLimiter.shouldLog(`${args.clinicId}:${args.userId}`)) {
      console.warn("[oprole-shadow] runner failed", err);
    }
  });
}

async function runShadowValidation(
  args: OperationalRoleShadowArgs,
): Promise<void> {
  const observed = args.observedOperationalRole;
  // Scheduler guard 2 ensures this is non-null at dispatch. Defensive
  // accounting in case a future change makes the branch reachable: route
  // it to _runner_failed so the invariant
  //   ran = match + driftRevoked + userMissing
  // continues to hold.
  if (observed === null) {
    incrementMetric("authority_oprole_shadow_runner_failed");
    return;
  }

  incrementMetric("authority_oprole_shadow_ran");

  const allowed = await currentReader({
    clinicId: args.clinicId,
    userId: args.userId,
  });

  if (allowed === null) {
    incrementMetric("authority_oprole_shadow_user_missing");
    return;
  }

  if (allowed.includes(observed)) {
    incrementMetric("authority_oprole_shadow_match");
    return;
  }

  incrementMetric("authority_oprole_shadow_drift_revoked");
  const logKey = `drift:${args.clinicId}:${args.userId}:${observed}`;
  if (shadowDriftLogLimiter.shouldLog(logKey)) {
    const payload = {
      event: "oprole_shadow_drift_revoked",
      clinicId: args.clinicId,
      userId: args.userId,
      checkInId: args.checkInId,
      observedOperationalRole: observed,
      allowlistSize: allowed.length,
      resolvedAt: args.resolvedAt,
      shadowAt: new Date().toISOString(),
    };
    console.warn("[oprole-shadow]", JSON.stringify(payload));
  }
}
