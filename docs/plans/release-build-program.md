# Release-Build Program — everything before the App Store resubmit

> **Owner decision 2026-07-16 (ultracode).** The App Store resubmission is the line in the sand: **all** planned production-ready functionality ships *before* build 26 resubmits. Post-resubmit = new features only, no going back to infra/architecture. Scope confirmed: **all 5 net-new feature subspecs + the 2 Code Blue races + socket.io (fully wired)**.
>
> Reconciled against git 2026-07-16 (doc trackers were stale): the 36-finding behavioral audit is otherwise DONE — 34/36 landed via #86/#91, and the last 2 open findings (CLICK-PATH-010/011) are **R-CB-stabilize, fixed as item 1 (PR #110)** → effectively 36/36 once #110 merges. The 6 audit-10x feature subspecs were **spec-authored only — zero implementation**. Each ships through `/ship-phase` (SDD+TDD → panel → PR → CodeRabbit-green). Subspecs are Tier **O+R** (frozen/⚠SUB-SPEC).

## Build order + status

| # | Item | Spec | Size | Status |
|---|---|---|---|---|
| 1 | **R-CB-stabilize** — 2 Code Blue races (CLICK-PATH-010/011) | `consolidated-audit-10x/subspecs/R-CB-stabilize-*.plan.md` | Small (1 hook + 2 tests) | 🟢 **build GREEN** (branch `claude/r-cb-stabilize`, f7fd25706) · panel + PR pending |
| 2 | **R-CBF-1** — one-tap Code Blue (frozen) | `…/R-CBF-1-code-blue-one-tap.plan.md` | Large | 🟡 **STARTED** (branch `claude/r-cbf-1-one-tap` off merged main). Spec read in full; build order 1.2→1.1→1.3→1.4→1.5. **Model reconciled:** a "cart" = a `vt_equipment` row (linked via log-entry category `equipment`, `code-blue-linked-equipment.ts`), so R-CBF-1.2 `reservedForSessionId` is an additive nullable column on **core `vt_equipment`** (scoped to crash-cart-type); R-CBF-1.1's nearest-ready-cart resolver is **net-new** (no existing resolver). Next: build R-CBF-1.2. |
| 3 | **R-M1** — RFID-gate e2e (managed reader + directional gates + board producer) | `…/R-M1-rfid-gate-e2e.plan.md` | Massive | ⏳ shares board seam w/ #4 |
| 4 | **R-BDF-1** — ambient board anomaly alerts | `…/R-BDF-1-ambient-board-alerts.plan.md` | Medium | ⏳ build on #3's board producer |
| 5 | **R-SH-F1** — shift handover + Priza | `…/R-SH-F1-shift-handover.plan.md` | Large (new table + generator + PMS seam) | ⏳ independent |
| 6 | **R-PDF-1** — predictive readiness (Analytics panel) | `…/R-PDF-1-predictive-readiness.plan.md` | Massive (inference model) | ⏳ independent |
| 7 | **R-RTC-1** — socket.io: fix 3 criticals + 6 highs, then FULLY WIRE into shift-chat/board/record UI | `…/R-RTC-1-realtime-collaboration.plan.md` | Large | 🟡 server built (branch `claude/rrtc1-socketio` b12f9aaa2) · panel done (findings below) · fixes + UI wiring pending |

**Sequencing:** 1 → 2 (gated); 3 → 4 (shared board-producer seam, build once); 5, 6, 7 independent (parallelizable). Socket.io (7) runs alongside.

## R-RTC-1 panel findings (2026-07-16, 6-lens) — fix before wiring
Frozen-surface isolation + multi-tenancy + no-PII = VERIFIED SOLID. But: **C1** `io.close()` kills the shared HTTP server on the Redis-absent prod boot path (endangers Code Blue; empirically reproduced) · **C2** Clerk-mode handshake auth broken → 0 users authenticate in prod (4 lenses) · **C3** emergency-isolation scanner regex misses dynamic `import()` · **H1** client singleton = global kill-switch (no ref-count/leaveCollabRoom) · **H2** no rate-limit on 5 WS events + unbounded rooms (DoS) · **H3** `join` unhandled rejection on malformed payload · **H4** client native origin dead on `capacitor://` (reuse api-origin.ts) · **H5** presence non-convergence multi-instance (`mirrorLeaseToRedis` dead) · **H6** client seam (stale-token reconnect, untyped events, `ack as never`) + test-depth gaps. Full detail: job ledger `rrtc1-panel-ledger.md`.

## Mini-phases roadmap (dependency-ordered) — 2026-07-16

**Dependency graph** (→ = "must merge before"):
```
R-CB-stabilize ──▶ R-CBF-1                    (Code Blue chain — frozen, sequential)
R-M1 (…R-M1.3 board producer) ──▶ R-BDF-1     (Board chain — shared board seam)
R-RTC-1 fix ──▶ R-RTC-1 wire                  (socket.io — fix criticals first, then UI)
R-SH-F1        (independent)
R-PDF-1        (independent)
```
**Two cross-cutting serialization constraints:**
1. **Migrations:** R-CBF-1 (`reservedForSessionId` col), R-M1 (`vt_rfid_readers`), R-SH-F1 (`vt_shift_handover`) each run `drizzle-kit generate`. Parallel branches would collide on the migration NUMBER — so schema branches **rebase on merged main + regenerate SQL in merge order**. Only one schema branch is "ahead of main" un-merged at a time.
2. **Board files:** R-M1, R-BDF-1, and R-RTC-1's board wiring all touch `equipment-command-board.service.ts` / `shared/equipment-board.ts` / `src/features/command-board/`. Sequence: R-M1 → R-BDF-1 → socket.io board overlay (additive channel, separate files where possible).

**Waves** (build in parallel worktrees where independent; PRs serialize through the owner's merge):

- **Wave 0 — DONE:** R-CB-stabilize (PR #110, merge-gating R-CBF-1).
- **Wave 1 (start now):**
  - **1B · R-RTC-1 fix** (independent, panel-ready) — 3 criticals (io.close server-crash · Clerk auth · isolation-regex) + 6 highs. Removes the prod-crash landmine. No migration.
  - **1A · R-CBF-1** — starts when #110 merges. Cards R-CBF-1.1 orchestration endpoint → .2 soft-reserve (schema) → .3 arm→hold client → .4 drug-dose ref → .5 e2e drill. Tier O+R.
- **Wave 2 (independent tracks):**
  - **2C · R-M1** — .0 resolver precedence → .1 managed reader entity (schema `vt_rfid_readers`) → .2 directional gates → .3 **board producer** → .4 last-seen/direction display → .5 e2e golden.
  - **2D · R-SH-F1** — .1 schema `vt_shift_handover` → .2 delta generator → .3 observed signals → .4 Priza PMS worklist → .5 surface → .6 verification.
  - **2E · R-PDF-1** — .1 demand model → .2 supply model → .3 shortfall + burn-rate → .4 Analytics panel + PO recs → .5 verification.
- **Wave 3 (dependent):**
  - **3F · R-BDF-1** — .1 anomaly rules → .2 board attention section → .3 telemetry → .4 verification. After R-M1.3 board producer merges.
  - **3G · R-RTC-1 wire** — lazy-connect the client into shift-chat (typing/presence), board (cursors/co-presence), record-detail (co-presence) + a11y/RTL/i18n + iOS/iPad device drill. After 1B + coordinate board files with 2C/3F.
- **Wave 4 — release close:** 4-platform flow-walk re-run over the new surfaces · What's-New collaboration line · owner submission gate (T-06…T-16) · resubmit build 26.

**Per-item pipeline:** each is its own `/ship-phase` run (SDD+TDD per card → pre-PR panel/lenses → PR → CodeRabbit-green), branched off merged main, Tier O+R for the frozen/sub-spec surfaces.

## Not release-scope (future)
Phase-4 massives (massive-03 clinic-network, medium-04 copilot/voice — parked). RLS, worker-split (owner-gated programs). The owner submission-gate T-06…T-16 (reviewer account, SIWA, Sentry privacy manifest, Info.plist prompts, AASA, review notes, on-device drill) is owner-manual — the actual App-Store gate, tracked separately.
