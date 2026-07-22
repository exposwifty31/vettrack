/**
 * Bounded per-job-kind latency tracking (p50/p95/p99) for the pilot job runtime.
 *
 * Keyed by the closed `JobKind` enum — no labels, no PII, bounded cardinality
 * (one small ring buffer per known kind), consistent with the frozen "no
 * high-cardinality telemetry" doctrine. Surfaced through the existing metrics
 * snapshot (`getMetricsSnapshot().jobLatency`), NOT a new route.
 */
import type { JobKind } from "../jobs/registry.js";

export interface JobLatencyStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

/** Max retained samples per kind (bounds memory + cardinality). */
const MAX_SAMPLES = 200;

/**
 * Closed allowlist of job kinds. The `satisfies` clause guarantees every entry
 * is a real `JobKind`; the `_ExhaustiveCheck` below fails compilation if a
 * `JobKind` is ever added without being tracked here.
 */
const KNOWN_JOB_KINDS = [
  "check-plug",
  "task-ownership-backfill",
  "stale-task-ownership-sweep",
  "check-expiry",
  "sweep-stale-checkins",
  "sweep-stale-checkouts",
  "sweep-stale-returned",
  "sweep-room-escalation",
  "integration-sync-enqueue",
  "scan-restock-burn",
] as const satisfies readonly JobKind[];

type _ExhaustiveCheck = Exclude<JobKind, (typeof KNOWN_JOB_KINDS)[number]> extends never
  ? true
  : ["job-latency KNOWN_JOB_KINDS is missing a JobKind", Exclude<JobKind, (typeof KNOWN_JOB_KINDS)[number]>];
const _exhaustive: _ExhaustiveCheck = true;
void _exhaustive;

const KNOWN = new Set<string>(KNOWN_JOB_KINDS);
const samplesByKind = new Map<JobKind, number[]>();

/**
 * Record a job's completion latency. Ignores unknown kinds (no high-cardinality
 * leakage) and non-finite/negative durations (fail-safe).
 */
export function recordJobLatency(kind: JobKind, durationMs: number): void {
  if (!KNOWN.has(kind)) return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  let arr = samplesByKind.get(kind);
  if (!arr) {
    arr = [];
    samplesByKind.set(kind, arr);
  }
  arr.push(durationMs);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

/**
 * Time an async job body with a MONOTONIC clock (`performance.now()` — immune to
 * wall-clock adjustments) and record its duration under `kind` on success OR
 * failure (finally). The single place job latency is measured; the error
 * propagates unchanged.
 */
export async function withJobLatency<T>(kind: JobKind, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    recordJobLatency(kind, performance.now() - startedAt);
  }
}

/** Nearest-rank percentile over a sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function statsFor(samples: number[]): JobLatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/** Per-kind latency stats for every kind with at least one sample. */
export function getJobLatencySnapshot(): Record<string, JobLatencyStats> {
  const out: Record<string, JobLatencyStats> = {};
  for (const [kind, samples] of samplesByKind) {
    if (samples.length > 0) out[kind] = statsFor(samples);
  }
  return out;
}

export function resetJobLatencyForTests(): void {
  samplesByKind.clear();
}
