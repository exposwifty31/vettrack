# Release-Build Program — everything before the App Store resubmit

> **Owner decision 2026-07-16 (ultracode).** The App Store resubmission is the line in the sand: **all** planned production-ready functionality ships *before* build 26 resubmits. Post-resubmit = new features only, no going back to infra/architecture. Scope confirmed: **all 5 net-new feature subspecs + the 2 Code Blue races + socket.io (fully wired)**.
>
> Reconciled against git 2026-07-16 (doc trackers were stale): the 36-finding behavioral audit is otherwise DONE (34/36; all code T-cards landed via #86/#91). The 6 audit-10x feature subspecs were **spec-authored only — zero implementation**. Each ships through `/ship-phase` (SDD+TDD → panel → PR → CodeRabbit-green). Subspecs are Tier **O+R** (frozen/⚠SUB-SPEC).

## Build order + status

| # | Item | Spec | Size | Status |
|---|---|---|---|---|
| 1 | **R-CB-stabilize** — 2 Code Blue races (CLICK-PATH-010/011) | `consolidated-audit-10x/subspecs/R-CB-stabilize-*.plan.md` | Small (1 hook + 2 tests) | 🟢 **build GREEN** (branch `claude/r-cb-stabilize`, f7fd25706) · panel + PR pending |
| 2 | **R-CBF-1** — one-tap Code Blue (frozen) | `…/R-CBF-1-code-blue-one-tap.plan.md` | Large | ⏳ gated behind #1 |
| 3 | **R-M1** — RFID-gate e2e (managed reader + directional gates + board producer) | `…/R-M1-rfid-gate-e2e.plan.md` | Massive | ⏳ shares board seam w/ #4 |
| 4 | **R-BDF-1** — ambient board anomaly alerts | `…/R-BDF-1-ambient-board-alerts.plan.md` | Medium | ⏳ build on #3's board producer |
| 5 | **R-SH-F1** — shift handover + Priza | `…/R-SH-F1-shift-handover.plan.md` | Large (new table + generator + PMS seam) | ⏳ independent |
| 6 | **R-PDF-1** — predictive readiness (Analytics panel) | `…/R-PDF-1-predictive-readiness.plan.md` | Massive (inference model) | ⏳ independent |
| 7 | **R-RTC-1** — socket.io: fix 3 criticals + 6 highs, then FULLY WIRE into shift-chat/board/record UI | `…/R-RTC-1-realtime-collaboration.plan.md` | Large | 🟡 server built (branch `claude/rrtc1-socketio` b12f9aaa2) · panel done (findings below) · fixes + UI wiring pending |

**Sequencing:** 1 → 2 (gated); 3 → 4 (shared board-producer seam, build once); 5, 6, 7 independent (parallelizable). Socket.io (7) runs alongside.

## R-RTC-1 panel findings (2026-07-16, 6-lens) — fix before wiring
Frozen-surface isolation + multi-tenancy + no-PII = VERIFIED SOLID. But: **C1** `io.close()` kills the shared HTTP server on the Redis-absent prod boot path (endangers Code Blue; empirically reproduced) · **C2** Clerk-mode handshake auth broken → 0 users authenticate in prod (4 lenses) · **C3** emergency-isolation scanner regex misses dynamic `import()` · **H1** client singleton = global kill-switch (no ref-count/leaveCollabRoom) · **H2** no rate-limit on 5 WS events + unbounded rooms (DoS) · **H3** `join` unhandled rejection on malformed payload · **H4** client native origin dead on `capacitor://` (reuse api-origin.ts) · **H5** presence non-convergence multi-instance (`mirrorLeaseToRedis` dead) · **H6** client seam (stale-token reconnect, untyped events, `ack as never`) + test-depth gaps. Full detail: job ledger `rrtc1-panel-ledger.md`.

## Not release-scope (future)
Phase-4 massives (massive-03 clinic-network, medium-04 copilot/voice — parked). RLS, worker-split (owner-gated programs). The owner submission-gate T-06…T-16 (reviewer account, SIWA, Sentry privacy manifest, Info.plist prompts, AASA, review notes, on-device drill) is owner-manual — the actual App-Store gate, tracked separately.
