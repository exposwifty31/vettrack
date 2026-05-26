/**
 * Pilot job runtime readiness snapshot (Phase 1b / F2b).
 * Kept separate from runtime.ts so metrics can read readiness without
 * importing the BullMQ worker graph (avoids metrics ↔ runtime circular load).
 */

export type RuntimeWorkerReadiness = { name: string; ok: boolean };

let runtimeStarted = false;
let workerStartupResults: RuntimeWorkerReadiness[] = [];

export function setJobRuntimeReadinessState(params: {
  started: boolean;
  workers: RuntimeWorkerReadiness[];
}): void {
  runtimeStarted = params.started;
  workerStartupResults = params.workers.map((w) => ({ name: w.name, ok: w.ok }));
}

export function getRuntimeReadiness(): {
  started: boolean;
  workers: RuntimeWorkerReadiness[];
} {
  return {
    started: runtimeStarted,
    workers: workerStartupResults.map((r) => ({ name: r.name, ok: r.ok })),
  };
}

/** Test-only: reset readiness without closing Redis workers. */
export function resetJobRuntimeReadinessForTests(): void {
  runtimeStarted = false;
  workerStartupResults = [];
}
