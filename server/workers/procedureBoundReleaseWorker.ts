/** Procedure-bound hospitalization column removed — sweep is a no-op. */

const RELEASE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export async function runProcedureBoundReleaseSweep(
  _now: Date = new Date(),
): Promise<{ scanned: number; released: number }> {
  return { scanned: 0, released: 0 };
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startProcedureBoundReleaseWorker(): void {
  if (_intervalId !== null) return;

  _intervalId = setInterval(() => {
    runProcedureBoundReleaseSweep().catch((err) => {
      console.error("[procedure-bound-release-worker] sweep failed:", err);
    });
  }, RELEASE_SWEEP_INTERVAL_MS);
}
