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
| `phase-0-1.plan.md` | **Phase 0** (6 HIGH fixes + 0B submission gate) + **Phase 1** (equipment/shift/inventory fixes + small features + web admin-gate) | ⏳ pending |
| `phase-2-3.plan.md` | **Phase 2** native-reachable MED sweep + **Phase 3** LOW cleanup (+ pointers to feature sub-specs) | ⏳ pending |
| `phase-4.plan.md` | **Phase 4** — massive-03 (clinic network) + medium-04 (copilot/voice) | 🚧 on hold (owner) |
| `subspecs/R-M1-rfid-gate-e2e.plan.md` | **massive-01** RFID-gate e2e — managed reader entity + directional gates + board surfacing + resolver reconciliation | 🟢 scoped, ready to author |
| `subspecs/R-CBF-1-code-blue-one-tap.plan.md` | medium-01 (frozen Code Blue surface) | ▫ later |
| `subspecs/R-SH-F1-shift-handover.plan.md` | medium-02 (superset + Priza integration) | ▫ later |
| `subspecs/R-PDF-1-predictive-readiness.plan.md` | massive-02 (inference-first demand model) | ▫ later |

## Why phase plans and sub-specs are separate

Phase plans hold **directly Sonnet-executable** task cards — localized fixes and small features. The `⚠ SUB-SPEC` items (frozen surfaces or Medium+ features) each get their **own** SDD spec-plan, so a lower-reasoning executing agent never one-shots a frozen surface (spec §2.4). The phase plans link out to them.

## Phase spine

See spec §3 for the authoritative table. In brief: **P0** stabilize + ship-ready → **P1** mine existing data (native-safe) → **P2** do-next features + native MED → **P3** low-severity cleanup → **P4** gated Massives.

## How to execute a plan

Each card: **RED** (write the failing test) → **GREEN** (minimal impl) → **verify** (`pnpm test -- <file> && pnpm typecheck`). Log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md` before marking a requirement done. Commit per requirement; new commits only.
