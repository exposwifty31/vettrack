# Autopilot proposal-quality backtest — Task 0.5

> **⚠️ THESE ARE SYNTHETIC NUMBERS. THEY ARE NOT DERIVED FROM REAL CLINIC DATA.**
>
> The original Task 0.5 spec (`docs/vettrack-2.0-roadmap.md`, "Task 0.5 — Operations-memory
> backtest") asked for a script that reads real prod-copy `vt_event_outbox` history for one
> clinic-month, hand-labeled against real staff behavior, to produce the precision/recall numbers
> Task 2.5 cites when choosing `enforce` thresholds.
>
> **No prod-copy data or real clinic history exists anywhere reachable in this environment.**
> Checked before writing this doc: the dev DB is empty/seed-scale (no month of real shift/outbox
> history to hand-label), there are no dump files in the repo or workspace, and no
> `docs/plans/2.0/` backtest artifact existed prior to this task. This is a disclosed deviation,
> owner-approved: build the harness on **synthetic data** instead of fabricating a "real" backtest
> from data that doesn't exist. This follows the same disclosed-deviation pattern as Task 0.3's
> citation-validator finding (`docs/plans/2.0/autopilot-spike-findings.md` §5) — investigated and
> written up openly, not hidden.
>
> **Task 2.5 MUST NOT use these numbers to set real enforce thresholds — they establish the harness
> and methodology only. Re-run against real clinic-month data before any threshold decision.**

## What this is / isn't

- **Is:** a working, deterministic backtest harness (`scripts/analysis/autopilot-backtest.ts`) that
  computes precision/recall/F1 per Autopilot proposal kind from a confusion matrix, plus one
  concrete run of it against a synthetic dataset shaped like "one clinic-month of shift activity."
- **Isn't:** a measurement of how good Autopilot's real proposal logic actually is. Three of the
  four kinds below have no classifier built yet at all (see "Proposal kinds modeled" below) — their
  numbers describe an invented stand-in heuristic, not a real system.

## Script

`scripts/analysis/autopilot-backtest.ts` — standalone, no DB connection, no imports from
`server/schema/*`. Run via:

```bash
pnpm exec tsx scripts/analysis/autopilot-backtest.ts
```

Exits 0 on success and prints an unmissable synthetic-data banner before the table (see actual
output below).

## Proposal kinds modeled

Per `docs/plans/2.0/autopilot-spike-findings.md`, only **`shift_handover_draft`** has real
production logic today (`server/lib/autopilot/*` — the propose→approve loop proven in Task 0.3).
The roadmap names three more planned kinds with no classifier built yet:
`coordinator-reassign-when-off-roster`, `restock-PO-on-burn`, `crash-cart-drift`. The script models
all four; for the latter three, the "would Autopilot propose" behavior is a **documented synthetic
heuristic standing in for the not-yet-built classifier** — explicitly labeled as such in the script
and here, not presented as if it were real.

## Synthesis methodology (matches what the script actually does)

This is a from-scratch description of `scripts/analysis/autopilot-backtest.ts` as written — reproduce
or critique against the script itself, not an idealized summary.

1. **Deterministic PRNG, not `Math.random()`/`Date.now()`.** A `mulberry32` generator seeded with
   the fixed literal `0x5eedc0de`. Re-running the script produces byte-identical output every time
   (verified: two consecutive runs diffed with zero output).

2. **One synthetic clinic-month = 90 shift-windows per kind.** `30 days x 3 shifts/day = 90`
   windows, evaluated independently for each of the 4 proposal kinds (360 synthetic situations
   total across the month).

3. **Per-kind parameters** (`KIND_CONFIGS` in the script) — a prior probability that the situation
   was a genuine one (`pPositive`), a detector sensitivity (`sensitivity` — P(signal fires | truly
   positive), drives recall), and a false-alarm rate (`fpr` — P(signal fires | truly negative),
   drives precision). `shift_handover_draft` is configured with the highest sensitivity / lowest
   false-alarm rate of the four, reflecting that it has real production logic; the other three use
   deliberately noisier, invented parameters standing in for their not-yet-built classifiers.

4. **Per shift-window, two independent Bernoulli draws off the shared PRNG stream**, in this exact
   order (kind outer loop, window inner loop — top to bottom of `KIND_CONFIGS`, then
   `0..WINDOWS_PER_KIND`):
   - `groundTruthPositive = rng() < pPositive` — "would an equivalent action genuinely have been
     the correct move here, per what staff actually ended up doing?" (the ground-truth label).
   - `signalFires = rng() < (groundTruthPositive ? sensitivity : fpr)` — "would Autopilot's
     proposal logic have raised a proposal in this window?" — a noisy detector reading conditioned
     on the ground-truth label.

   This is the standard synthetic-classifier-eval construction (draw the true label, then draw a
   conditioned noisy detector reading). Because `sensitivity` and `fpr` are both strictly between 0
   and 1 for every kind, the draws deliberately do **not** agree 100% of the time: some windows are
   false negatives (staff handled it, Autopilot's signal would have missed it) and some are false
   positives (Autopilot's signal would have fired, staff's actual behavior didn't match it). The
   numbers are meaningful confusion-matrix outputs, not a trivial 1.0/1.0.

5. **Confusion matrix → metrics**, per kind: `precision = tp/(tp+fp)`, `recall = tp/(tp+fn)`,
   `f1 = 2·precision·recall/(precision+recall)` (each guarded against divide-by-zero, returning 0).

## Actual output (verbatim — copied from a real run, not hand-written)

```
==============================================================================
SYNTHETIC DATA — NOT real clinic history.
See docs/plans/2.0/autopilot-backtest.md for methodology and required re-run before
any enforce threshold is set.
==============================================================================

Synthetic dataset: 1 clinic-month (30 days x 3 shifts/day = 90 shift-windows) per proposal kind.
Seed: 0x5eedc0de (mulberry32, fixed literal — deterministic re-run).

kind                                  n   tp  fp  fn  precision  recall  f1   
------------------------------------  --  --  --  --  ---------  ------  -----
shift_handover_draft                  90  29  5   2   0.853      0.935   0.892
coordinator-reassign-when-off-roster  90  10  15  8   0.400      0.556   0.465
restock-PO-on-burn                    90  16  12  5   0.571      0.762   0.653
crash-cart-drift                      90  4   15  2   0.211      0.667   0.320

hasRealLogic per kind: shift_handover_draft=true, coordinator-reassign-when-off-roster=false, restock-PO-on-burn=false, crash-cart-drift=false
```

n = 90 shift-windows per kind = 1 synthetic clinic-month, per the task's Verify criteria (n≥1
clinic-month) — synthetic, not real, per the banner above.

Re-running the script reproduces this table exactly (two consecutive runs were diffed byte-for-byte
identical as part of verifying this doc).

## Reading the numbers (and why they must not be used for real thresholds)

`shift_handover_draft` scores highest because it was deliberately configured with the least noise,
modeling that it has real production logic behind it (Task 0.3). The other three kinds score lower
because they were deliberately configured with more noise, modeling that no classifier exists for
them yet. **None of these relative rankings are evidence about real-world Autopilot quality** —
they are an artifact of parameters this script's author chose. A different, equally defensible
choice of `pPositive`/`sensitivity`/`fpr` would produce different numbers.

**Task 2.5 MUST NOT use these numbers to set real enforce thresholds.** This harness exists to
prove the precision/recall/F1 computation and reporting shape works end-to-end. Before any
`enforce` threshold decision, someone must:

1. Get real prod-copy `vt_event_outbox` history for at least one clinic-month (this environment had
   none reachable).
2. Hand-label ground truth against real staff behavior for each proposal kind that exists at that
   time.
3. Re-run a version of this harness (or its confusion-matrix/metrics logic) against that real,
   hand-labeled data.
4. Only then cite the resulting precision/recall/F1 in Task 2.5's threshold discussion.
