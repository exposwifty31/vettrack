# Consolidated Audit × 10x — Plan Library (start here)

Single front door for the consolidated remediation + 10x feature program. The **design spec is the source of truth**; the plan docs below expand its requirements into executable, test-first task cards.

- **Branch:** `claude/audit-10x-consolidated-plan` (off `main`).
- **Execution model:** SDD (numbered requirements traced to findings/features) + TDD (RED test first) + **Sonnet-sized** cards (≤2 code files + 1 test, exact anchors, zero open decisions). See spec §2.

## Source documents

| Doc | Path |
|---|---|
| **Design spec (source of truth)** | `../../superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md` |
| massive-01 cost/benefit (`R-M1-PRE`) | `../../business-case/2026-07-12-massive-01-passive-tracking-cost-benefit.md` |
| Behavioral audit (36 findings) | `../../audit/flow-audit-behavioral-2026-07-11.md` |
| 10x feature briefs (reference) | `../../../.claude/docs/ai/vettrack/10x/` |

## Plan documents

| Plan | Covers | Status |
|---|---|---|
| `phase-0-1.plan.md` | **Phase 0** (6 HIGH fixes + 0B submission gate) + **Phase 1** (equipment/shift/inventory fixes + small features + web admin-gate) | ✅ authored (31 **top-level requirements** T-01…T-31; several decompose into dispatchable subcards — e.g. T-22a–c, T-23a–e, T-24a–e, T-28a–b, T-30a1-i/-ii · T-30a2-i/-ii · T-30b · T-30c) |
| `phase-2-3.plan.md` | **Phase 2** native-reachable MED sweep + **Phase 3** LOW cleanup (+ pointers to feature sub-specs) | ✅ authored (T-34…T-53; T-32/T-33 moved to the R-CB-stabilize sub-spec) |
| `phase-4.plan.md` | **Phase 4** — massive-03 (clinic network) + medium-04 (copilot/voice) | ✅ authored · 🚧 on hold (entry conditions) |
| `subspecs/R-M1-rfid-gate-e2e.plan.md` | **massive-01** RFID-gate e2e — managed reader entity + directional gates + board surfacing + resolver reconciliation | ✅ authored (R-M1.0…M1.5) |
| `subspecs/R-CBF-1-code-blue-one-tap.plan.md` | medium-01 (frozen Code Blue surface) | ✅ authored (R-CBF-1.1…1.5) |
| `subspecs/R-CB-stabilize-code-blue-races.plan.md` | R-CB-02/03 — frozen Code Blue race fixes (gate medium-01) | ✅ authored |
| `subspecs/R-BDF-1-ambient-board-alerts.plan.md` | medium-03 (board anomaly rules; shares the R-M1.3 board seam) | ✅ authored (R-BDF-1.1…1.4) |
| `subspecs/R-SH-F1-shift-handover.plan.md` | medium-02 (superset + Priza integration) | ✅ authored (R-SH-F1.1…1.6) |
| `subspecs/R-PDF-1-predictive-readiness.plan.md` | massive-02 (inference-first demand model) | ✅ authored (R-PDF-1.1…1.5) |

## Why phase plans and sub-specs are separate

Phase plans hold **directly Sonnet-executable** task cards — localized fixes and small features. The `⚠ SUB-SPEC` items (frozen surfaces or Medium+ features) each get their **own** SDD spec-plan, so a lower-reasoning executing agent never one-shots a frozen surface (spec §2.4). The phase plans link out to them.

## Phase spine

See spec §3 for the authoritative table. In brief: **P0** stabilize + ship-ready → **P1** mine existing data (native-safe) → **P2** do-next features + native MED → **P3** low-severity cleanup → **P4** gated Massives.

## How to execute a plan

Each card: **RED** (write the failing test) → **GREEN** (minimal impl) → **verify** (`pnpm test -- <file> && pnpm typecheck`). Log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md` before marking a requirement done. Commit per requirement; new commits only.

## Execution driver — per-card model routing

Each card carries a **Tier** that selects the model for the **subagent** that executes it. The main-loop model is irrelevant: a card is dispatched to a subagent at its Tier (`Agent(prompt, { model: <tier> })`), so a cheap main loop can still route a frozen card to Opus. (A `fork` can't — it inherits the parent model — so use a fresh subagent, not a fork.)

**Tier legend**
- **S** — Sonnet. Default for localized, well-anchored fix/feature cards.
- **S +R** — Sonnet, but a `code-reviewer` pass (and, for realtime/PWA cards, the browser drill) **before commit**. Frozen-but-localized cards.
- **O +R** — Opus + the `code-reviewer` gate (+ drill). Frozen-subtle cards and **every `⚠ SUB-SPEC` doc**.
- **Owner** — executed by the owner (account/build/device/hardware), not a model choice (e.g. the 0B submission gate).

**Deterministic routing rule** (a dispatcher applies these in order — **protection is a floor the inline tag can raise but never lower**, so an inline `Tier: S` can never downgrade a protected card past its review gate):
1. **Establish the protection floor first:** a `⚠ SUB-SPEC` doc → floor = **O +R**; a `⚠ FROZEN` card — **including any card under a `⚠ FROZEN`-tagged *section header*; the flag is inherited by every card in that section** — → floor = **S +R**; otherwise floor = **S**.
2. If the card carries an inline `Tier: …` tag, the effective Tier = **the stronger of {inline tag, floor}** (`O +R` > `S +R` > `S`) — the tag may **raise** above the floor but **never lower below it**, so a frozen/sub-spec card can never resolve to plain `S`.
3. No inline tag → use the floor.

(This preserves an intentional frozen-but-localized `Tier: S +R` while closing the hole where an inline `Tier: S` on a protected card would skip the reviewer / browser-drill gate.)

**Per card:** dispatch to a subagent at its Tier → RED→GREEN→verify → for any `+R`, run the `code-reviewer` gate (+ browser drill for realtime/PWA) → only then commit → log to the proof log. A frozen card never skips the drill regardless of model.

**Exception — operational cards:** Tier `Owner` cards (the Phase-0 0B submission gate T-06–T-15 and the T-16 on-device drill) are **binary / on-device checks, not RED→GREEN** — their "done" is the pass/fail verification stated on each card, not a unit test.
