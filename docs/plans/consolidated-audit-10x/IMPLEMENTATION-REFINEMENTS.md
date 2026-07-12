# Implementation-time refinements (logged backlog — non-blocking)

**Status:** The plan passed a fresh-reader **executability audit** (every card: exact anchors, a RED test, a deterministic verify command, zero open decisions) — that is the plan's "done" gate. The items below are deeper-precision refinements surfaced by a subsequent CodeRabbit pass. They are **non-blocking** (0 Critical; all Major/Minor, all on parked Phase-2/4 features) and are meant to be resolved **at implementation time** — each is naturally caught by the named card's RED tests when the card is built. They are recorded here so the executing agent addresses them in-card rather than re-litigating the plan.

Rationale for logging rather than pre-specifying: CodeRabbit review of a large spec is asymptotic (finding counts across 15 passes: 26 → 22 → 12 → 18 → 7 → 18 → 15 → 18 → 21 — the count rose *after* a clean consolidation, because more prose = more nitpick surface). "Zero CodeRabbit comments" is unreachable by construction; the terminating criterion is the executability audit, which passed. See PR #85.

---

## R-CBF-1 (medium-01, Code Blue one-tap — Phase 2, gated behind stabilize)

- **Fence claim *release*, not only commit.** Every claim mutation — `release` and lease-renewal, not just the `committed` transition — must compare/CAS the current `(clinicId, token, fence)`. Otherwise a superseded slow owner could release the replacement owner's claim and reopen the duplicate-session race. RED: an expired claim is reclaimed, the old owner attempts release, the current owner's claim survives intact.

## R-M1 (massive-01, RFID-gate — Phase 4, hardware-gated)

- **Declare `gateType` nullable** in the `vt_rfid_readers` schema (a `legacy_unconfigured` reader has no `gateType` until configured).
- **Define + persist the egress source-event identity.** Pin the concrete column/shape of the `sourceEventId` used in the egress correlation key so retries/out-of-order batches dedupe deterministically against persisted state.

## R-SH-F1 (medium-02, shift handover — Phase 1 SUB-SPEC)

- **Pin read authorization** for the PMS-backed artifact — who may GET `/handoff` (the artifact carries per-tech PMS worklist data); scope to the clinic's rostered staff with the `clinicId` predicate.
- **Use an inclusive next-shift boundary.** Pin whether the next shift starts `>` or `>=` the current shift's end (off-by-one on the shift window / back-to-back shifts).
- **Make revision allocation atomic.** Concurrent scheduler retries can observe the same max revision and both insert `revision+1` → unique-conflict failure instead of returning the persisted snapshot. Require a transaction lock / serializable retry / unique-conflict recovery that reloads the existing revision.
- **Make notification delivery crash-safe.** If artifact persistence commits but the process crashes before the push enqueues, an idempotent retry returns the artifact and never re-enqueues. Persist a revision-keyed delivery intent in the same transaction (or route through the transactional outbox), then let the worker retry idempotently.

## R-PDF-1 (massive-02, predictive readiness — Phase 2 SUB-SPEC)

- **Define the concrete v1 `DemandSource` contract** (the exact interface shape the schedule-only impl and the later template impl both satisfy).
- **Make horizon selection deterministic:** pin the `asOf` boundary, clinic timezone, overlapping-procedure behavior, and the no-upcoming-procedure case; add a boundary fixture.
- **Specify the panel's loading / error / partial-data states** (Analytics panel UX completeness).
- **Test reservation exclusion** explicitly in the supply RED suite (reserved/allocated units excluded from `readySupply`).

## R-BDF-1 (medium-03, board anomalies — Phase 2 SUB-SPEC)

- **Align reappearance semantics with source-derived `since`.** For the rules whose `since` is derived from an existing snapshot timestamp (cart / reader), a clear-then-reappear should reflect the source timestamp, not a fresh observation time — reconcile with the single-shot state machine's re-fire rule.

## Spec + phase plans (consistency / anchoring)

- **spec §R-EQ-F2 / phase-0-1 T-23:** pin the exact readiness data contract — the `readinessState` response type, the six-`EquipmentStatus`-token → 3-tier mapping, and the badge prop flow — so the client consumes the server-derived field without re-derivation.
- **phase-0-1 T-13:** keep aligned with the now-split `R-AS-08a/b/c` AASA/entitlement/App-Store checks.
- **phase-0-1 T-30b / T-30c:** add exact implementation anchors.
- **phase-0-1 T-23e:** name every mechanical-mount target file explicitly (the fan-out sites).
- **phase-2-3 T-51:** scope the dead-symbol grep to the changed file (as done for T-46).
- **biz cost/benefit:** split the RTLS/BLE benchmark rows out of the RFID-gate payback model so the RFID payback isn't computed on BLE figures.
- **R-BDF-1 header:** hyphenate the compound modifier (copy-edit).
