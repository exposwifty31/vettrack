/**
 * Autopilot proposal-quality backtest harness — Task 0.5 (VetTrack 2.0 roadmap).
 *
 * DISCLOSED DEVIATION FROM THE ORIGINAL TASK SPEC:
 * The original spec asked this script to read real prod-copy `vt_event_outbox` history for one
 * clinic-month, hand-labeled against real staff behavior. No prod-copy data, dump file, or real
 * clinic history exists anywhere reachable in this environment (dev DB is empty/seed-scale; no
 * `docs/plans/2.0/` backtest artifact existed before this task). Owner-approved substitute: this
 * script generates a deterministic SYNTHETIC dataset instead of fabricating a fake "real" backtest.
 *
 * The numbers this script prints are NOT real precision/recall. They exist to stand up the harness
 * and methodology only. See docs/plans/2.0/autopilot-backtest.md for full methodology, and its
 * explicit instruction that Task 2.5 must re-run this against real clinic-month data before setting
 * any `enforce` threshold.
 *
 * No DB connection. No imports from server/schema/*. Fully self-contained so it has zero DB or
 * ESM-resolution dependency — run via: pnpm exec tsx scripts/analysis/autopilot-backtest.ts
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — NOT Math.random()/Date.now(). Fixed literal seed so re-running
// this script always reproduces the exact same synthetic dataset and the exact same table below.
// ---------------------------------------------------------------------------

const SEED = 0x5eed_c0de;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

// ---------------------------------------------------------------------------
// Proposal kinds under evaluation.
//
// `shift_handover_draft` is the ONE kind with real production logic today (server/lib/autopilot/*,
// per docs/plans/2.0/autopilot-spike-findings.md). The other 3 are roadmap-named future kinds with
// no classifier built yet — for those, `pPositive`/`sensitivity`/`fpr` below are a DOCUMENTED
// SYNTHETIC HEURISTIC standing in for a not-yet-built classifier, chosen to be plausible but
// intentionally noisier than the one kind with real logic. They are not derived from any
// measurement.
// ---------------------------------------------------------------------------

interface KindConfig {
  /** Proposal kind discriminator (mirrors the closed-union style used in server/lib/autopilot/*). */
  kind: string;
  /** Has real production classifier logic today, vs. a synthetic stand-in heuristic. */
  hasRealLogic: boolean;
  /** True prior probability that, in a given shift-window "situation", staff took the equivalent action. */
  pPositive: number;
  /** P(Autopilot signal fires | situation was a true positive) — drives recall. */
  sensitivity: number;
  /** P(Autopilot signal fires | situation was a true negative) — false-alarm rate, drives precision. */
  fpr: number;
}

const KIND_CONFIGS: readonly KindConfig[] = [
  {
    kind: "shift_handover_draft",
    hasRealLogic: true,
    pPositive: 0.35,
    sensitivity: 0.88,
    fpr: 0.08,
  },
  {
    kind: "coordinator-reassign-when-off-roster",
    hasRealLogic: false,
    pPositive: 0.18,
    sensitivity: 0.62,
    fpr: 0.22,
  },
  {
    kind: "restock-PO-on-burn",
    hasRealLogic: false,
    pPositive: 0.22,
    sensitivity: 0.7,
    fpr: 0.18,
  },
  {
    kind: "crash-cart-drift",
    hasRealLogic: false,
    pPositive: 0.12,
    sensitivity: 0.55,
    fpr: 0.15,
  },
];

// ---------------------------------------------------------------------------
// Synthetic clinic-month generation.
//
// One "clinic-month" = 30 days x 3 shifts/day = 90 shift-windows, evaluated independently per
// proposal kind (so total synthetic situations = 90 windows x 4 kinds = 360). Each window resolves
// two independent Bernoulli draws, seeded by the shared PRNG stream (draw order: kind, then
// window-within-kind, matching the loop order below — reproducible top to bottom):
//
//   1. groundTruthPositive = rng() < pPositive
//        "Would an equivalent action have genuinely been the correct move in this window, per
//         what staff actually ended up doing?" — the ground-truth label.
//   2. signalFires = rng() < (groundTruthPositive ? sensitivity : fpr)
//        "Would Autopilot's proposal logic (real, for shift_handover_draft; the documented
//         synthetic heuristic, for the other 3) have raised a proposal in this window?"
//
// This is the standard synthetic-classifier-eval construction: draw the ground-truth label first,
// then draw a noisy detector reading conditioned on that label via sensitivity/false-positive-rate.
// It deliberately does NOT force 100% agreement — sensitivity/fpr < 1 injects both false negatives
// (situations staff handled that Autopilot would have missed) and false positives (situations
// Autopilot would have flagged that staff's actual behavior didn't match), so the resulting
// precision/recall are meaningful rather than trivially 1.0/1.0.
// ---------------------------------------------------------------------------

const DAYS_PER_CLINIC_MONTH = 30;
const SHIFTS_PER_DAY = 3;
const WINDOWS_PER_KIND = DAYS_PER_CLINIC_MONTH * SHIFTS_PER_DAY; // 90 shift-windows = 1 clinic-month

interface ConfusionCounts {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}

function synthesizeConfusion(config: KindConfig): ConfusionCounts {
  const counts: ConfusionCounts = {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    trueNegative: 0,
  };

  for (let window = 0; window < WINDOWS_PER_KIND; window++) {
    const groundTruthPositive = rng() < config.pPositive;
    const detectorThreshold = groundTruthPositive ? config.sensitivity : config.fpr;
    const signalFires = rng() < detectorThreshold;

    if (groundTruthPositive && signalFires) counts.truePositive++;
    else if (!groundTruthPositive && signalFires) counts.falsePositive++;
    else if (groundTruthPositive && !signalFires) counts.falseNegative++;
    else counts.trueNegative++;
  }

  return counts;
}

interface KindResult extends ConfusionCounts {
  kind: string;
  n: number;
  precision: number;
  recall: number;
  f1: number;
}

function computeMetrics(kind: string, counts: ConfusionCounts): KindResult {
  const { truePositive, falsePositive, falseNegative, trueNegative } = counts;
  const n = truePositive + falsePositive + falseNegative + trueNegative;

  const precision =
    truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    kind,
    n,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1,
  };
}

function formatPct(value: number): string {
  return value.toFixed(3);
}

function printTable(results: readonly KindResult[]): void {
  const headers = ["kind", "n", "tp", "fp", "fn", "precision", "recall", "f1"];
  const rows = results.map((r) => [
    r.kind,
    String(r.n),
    String(r.truePositive),
    String(r.falsePositive),
    String(r.falseNegative),
    formatPct(r.precision),
    formatPct(r.recall),
    formatPct(r.f1),
  ]);

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex].length)),
  );

  const formatRow = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");

  const separator = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function main(): void {
  console.log("=".repeat(78));
  console.log("SYNTHETIC DATA — NOT real clinic history.");
  console.log(
    "See docs/plans/2.0/autopilot-backtest.md for methodology and required re-run before",
  );
  console.log("any enforce threshold is set.");
  console.log("=".repeat(78));
  console.log("");
  console.log(
    `Synthetic dataset: 1 clinic-month (${DAYS_PER_CLINIC_MONTH} days x ${SHIFTS_PER_DAY} shifts/day = ${WINDOWS_PER_KIND} shift-windows) per proposal kind.`,
  );
  console.log(`Seed: 0x${SEED.toString(16)} (mulberry32, fixed literal — deterministic re-run).`);
  console.log("");

  const results = KIND_CONFIGS.map((config) =>
    computeMetrics(config.kind, synthesizeConfusion(config)),
  );

  printTable(results);

  console.log("");
  console.log(
    "hasRealLogic per kind: " +
      KIND_CONFIGS.map((c) => `${c.kind}=${c.hasRealLogic}`).join(", "),
  );
}

main();
