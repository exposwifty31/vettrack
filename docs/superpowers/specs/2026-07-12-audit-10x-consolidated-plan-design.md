# Consolidated Plan — Behavioral Audit × 10x Feature Library (SDD Design Spec)

- **Date:** 2026-07-12
- **Status:** Design spec — pending owner review; feeds `writing-plans` (implementation plan)
- **Working branch:** `claude/audit-10x-consolidated-plan` (off `main`; `main` already contains merged PR #83)
- **Execution model:** SDD (spec-driven) + TDD (test-first) + **Sonnet-sized** tasks (see §2)
- **Sources consolidated:**
  - `docs/audit/flow-audit-behavioral-2026-07-11.md` — 36 behavioral state-composition findings (6 HIGH · 21 MEDIUM · 9 LOW).
  - `.claude/docs/ai/vettrack/10x/` — 12 executable feature briefs (3 Massive · 4 Medium · 5 Small) + `session-1.md` strategy.
- **Grounding:** all 36 finding anchors + 12 feature anchors verified against live `main` (2026-07-12). Refined by four domain lenses: Apple App Store review, Capacitor preflight, mobile/HIG, and WCAG 2.2 AA / product-design-fundamentals.

---

## 1. Purpose & framing decisions

One plan that sequences remediation debt and the 10x library **together**, so no feature is built on a broken surface, and the sequence is tilted toward passing the pending iOS App Store re-review.

Owner-selected framing:

| Decision | Choice |
|---|---|
| **Structure** | Surface-bundled — the unit of work is a *surface* carrying both its findings and its 10x feature(s), executed **stabilize → extend**. |
| **Priority lens 1** | Stabilize a surface before extending it (never ship a feature onto an open HIGH on its own surface). |
| **Priority lens 2** | App Store resubmission readiness reweights *across* surfaces. |
| **Scope** | Everything, phased. Gated Massives sit in a marked, blocked phase. |

**App Store reframing (critical):** the app is **already live** — this is a rejection-fix re-upload, so the dominant risk is Guideline **2.1** (reviewer can't reach/operate core features), not 4.2 (minimum functionality). The App-Store lever is therefore **Phase 0 reviewer-reachability (work-stream 0B)**, *not* deferring web-console surfaces — grounding proved only 3 of the "admin" findings are web-only (and all 3 are already LOW); the other 5 are native-reachable and keep their MEDIUM weight.

---

## 2. Execution model (every task obeys this)

### 2.1 SDD

- Every unit of work is a numbered **Requirement** (`R-<area>-##`) with a precise statement, **testable acceptance criteria**, and **traceability** to its source finding (`CLICK-PATH-###`) or feature (`small-0#` / `medium-0#` / `massive-0#`).
- The spec is the source of truth. The implementation plan (`writing-plans` output) may only expand requirements into task cards; it may not introduce behavior not in a requirement.

### 2.2 TDD

- Each requirement carries a **RED test** hook: the test file to create/update and the assertion that must FAIL against current code.
- Task order is always **RED → GREEN → REFACTOR → verify**. No implementation lands before its failing test exists.

### 2.3 Sonnet-sized task contract (the important one)

Because the executing agent reasons less, every task card produced from this spec MUST:
1. Touch **≤ 2 files** for the change + **1 test file** (larger requirements are split until they fit). **Exception — a *mechanical mount fan-out*** (mounting one already-built component at N call sites: a ≤2-line import+render per site, no logic) **is a single recognized card** whose ≤2-file bound applies to **implementation-logic files**, not the trivial per-site mounts; it must still name every site + one test asserting the mount on each. This is the ONLY multi-file exemption.
2. Cite **exact anchors** — `file:line` + symbol names. No "find the relevant code."
3. Carry **all context inline** — the defect, the fix direction, and the frozen-surface guardrails — so the card is understandable without reading other cards.
4. Contain **zero open decisions** — every choice is pre-made here. If a task would require judgment, it is under-specified and must be refined before dispatch.
5. End with a **deterministic verify command** and its expected result (a test that goes RED→GREEN, plus `pnpm typecheck`).

### 2.4 Complexity gate (honesty about Sonnet's limits)

A requirement is **directly Sonnet-executable** only if it is a localized change on a non-frozen surface. Requirements that are **net-new features of Medium+ size**, or **net-new / multi-site work on a frozen surface** (SSE/realtime, Code Blue runtime, authority/enforcement, offline/PWA, telemetry enums), are marked `⚠ SUB-SPEC` and MUST get a dedicated SDD spec-plan pass (their own requirements + task cards) before any Sonnet agent executes them. This spec defines them at requirement level only.

**Frozen-but-localized carve-out:** a *single-site wiring fix* on a frozen surface — e.g. **R-SY-01** (pass the QueryClient) or **R-CB-01** (dismiss a modal) — is directly executable at **Tier `S +R`** (Sonnet + a `code-reviewer` gate + the browser drill), because it is a one-site change guarded by a RED test and the frozen doctrine, not net-new frozen logic. `⚠ SUB-SPEC` stays reserved for net-new/multi-site frozen work (e.g. **R-CB-02/03** races). This resolves the apparent tension between "offline/PWA is frozen" and R-SY-01 being executed directly.

**On alternatives:** where a requirement below *sketches* options ("or", "either", "delete-or-wire"), its **plan card picks the single approach** — plan cards are decision-free and are the dispatch source of truth (the spec may sketch; the plan pins).

### 2.5 Standard feature checklist (inherited by every feature requirement)

Per `CLAUDE.md` §"Adding a new feature", **applied as relevant to each feature** (not every step applies to every feature): schema → `npx drizzle-kit generate` → commit SQL → route in `server/routes/` registered in `server/app/routes.ts` → `src/lib/api.ts` fn + `src/types/` type → lazy route in `src/app/routes.tsx` → he+en keys (parity, `pnpm i18n:check`) → audit kind added to the closed `AuditActionType` union → bounded-enum telemetry on client + `server/routes/realtime.ts` → `pnpm typecheck` clean.

**Conditional steps:** read-only / reused-data features (e.g. **small-01** locate, **small-02** badge) that add **no new table and no new mutation** skip schema/migration, the `AuditActionType` addition, and telemetry — they need only the route + api/type + i18n + typecheck. The full chain (schema → migration → audit kind → telemetry) applies only to features that persist new data or emit new events (e.g. **small-04** damage events, **medium-02** handover). Each feature card states which steps apply.

---

## 3. Phase spine

| Phase | Theme | Work-streams | Sonnet? |
|---|---|---|---|
| **0 — Stabilize + Ship-ready** | Pass iOS re-review | **0A** 6 HIGH fixes · **0B** reviewer-reachability & submission gate · **exit:** on-device drill | 0A yes · 0B mixed (ops) |
| **1 — Do-Now bundles** | Mine existing data (native-safe) | **Equipment** (fixes + small-01/02/04) · **Shift/Home** (fixes + medium-02/small-05) · **Inventory** (fixes + small-03) · **Web platform admin-gating** (NEW) | fixes yes · features small = yes · medium-02 `⚠ SUB-SPEC` · R-WEB-01 `S +R` |
| **2 — Do-Next + native MED** | Extend irreplaceable surfaces | **Code Blue** (2 race fixes R-CB-02/03 + medium-01) · **Board** (medium-03) · **Predictive** (massive-02) · **Native MED sweep** (11 fixes: R-SC-02/03 · R-SY-02/03/04 · R-PR-01 · R-AD-01..05 incl. 5 reclassified admin) — **13 P2 MED total** (Appendix A) | native-MED-sweep fixes yes · R-CB-02/03 (frozen Code Blue) `⚠ SUB-SPEC` · features `⚠ SUB-SPEC` |
| **3 — Cleanup + web-only** | Low visibility/severity | 9 LOW fixes (incl. the 3 genuinely web-only) | yes |
| **4 — Gated Massives** | Owner-decision-blocked | massive-01 passive RFID-gate · massive-03 clinic network · medium-04 copilot/voice | all `⚠ SUB-SPEC`; massive-03 + medium-04 blocked · massive-01 unblocked (`R-M1`) |

Finding accounting: 6 HIGH (P0) · 8 MED (P1) + 13 MED (P2) = 21 MED · 9 LOW (P3). Features: 6 (P1) + 3 (P2) + 3 (P4) = 12. ✓

---

## 8. Phase 4 — Gated Massives (blocked; all `⚠ SUB-SPEC`)

Do not start code on a still-gated item until the owner clears its standing blocker. **massive-03 and medium-04 remain fully blocked.**
- **massive-03 clinic network** — blocker: buyer identity (single vs multi-site) + a dedicated security design pass. Cross-tenant is the highest-risk surface; negative test (a non-group clinic can never read another's rows) is the acceptance bar.
- **medium-04 asset copilot / voice** — blocker (voice only): native shell sequencing; text copilot not blocked. Keep the mandatory citation + AI-safety validators; sequence after the data-quality wins.

---

## 9. Cross-cutting acceptance gates (every work-stream inherits)

**Interaction / mobile (HIG):** destructive/weighty actions get **Undo via the existing countdown toast**, not a blocking confirm — the only exceptions are attestations (medium-02 ack) and irreversible commits (medium-01 hold-to-start); **undo applies to all roles including students (no role carve-out)**; primary actions in the thumb arc; routine hands-full choices are bottom sheets with detents, alerts/mode-changes are centered/full-screen.

**Accessibility (WCAG 2.2 AA — pass/fail):**
- Every interactive control ≥ **44×44 CSS px** hit area (48 preferred); ≥8px spacing when either adjacent target is undersized.
- **No color-only status** (1.4.1) — every coded state ships icon/text/shape too.
- Text contrast ≥ 4.5:1 (3:1 large); non-text UI ≥ 3:1 — checked in **both** themes (badge tiers included).
- Visible focus (2.4.7/2.4.11); every sheet/modal traps focus only while open, moves focus in on open, restores to trigger on close, and is **Escape/VoiceOver-dismissible** (the regression gate for the CLICK-PATH-001/002/003/005 dead-control class — "Cancel works independent of the happy path").
- `prefers-reduced-motion` variant for every animation; `aria-live` (polite default; assertive only for Code Blue state) for content that updates without user action.
- **RTL/bidi:** logical CSS props; every embedded LTR run (device names, model numbers, dates) bidi-isolated; directional icons mirrored (regression gate for the confirmed bidi bugs).
- **i18n parity:** every new string in `he.json` + `en.json` same commit; `pnpm i18n:check` green; no hardcoded copy in `.ts/.tsx`.

**Design-fundamentals:** one dominant primary action per surface; every list/search/dashboard has designed empty + loading + error states; reuse design-system primitives (no ad-hoc badge/sheet variant); tokens only (no inline hex); a traced onClick→state→final-render path with no early-return that skips a close/reset (the audit's core defect class).

---

## 10. Execution context

- **Branch:** `claude/audit-10x-consolidated-plan` off `main`. New commits only; no amend/force-push/`--no-verify`. Commit per completed requirement.
- **Frozen surfaces (never weaken):** SSE transport + monotonic outbox cursor; no offline emergency queueing; no emergency endpoint in any cache; bounded-enum telemetry; Strategy A authority safety net; `appointmentsPage.*` / `vt_appointments` / `/api/appointments` names. **Net-new or multi-site work on these is `⚠ SUB-SPEC`; a localized wiring fix (e.g. R-SY-01, R-CB-01) stays `S +R` per §2.4** — the carve-out is not weakened.
- **Proof:** before marking any requirement done, log verification evidence (the RED→GREEN test run, the command output) in `docs/audit/PROOF_ALIGNMENT_LOG.md` per that file's format.
- **Gates before merge:** `pnpm typecheck`, the requirement's test, and (for realtime/PWA/Code-Blue-adjacent work) the Playwright drills.
- **The 10x briefs** (`.claude/docs/ai/vettrack/10x/`) reach `main` via their own PR; this spec references them but does not commit them.

## 11. Owner-gated decisions & open questions

**Resolved (2026-07-12, owner) — folded into the requirements above:**
- medium-02 delta scope → **all 4 deltas + per-tech patient/animal worklist + app-observed signals + Priza integration constraint** (R-SH-F1).
- massive-02 demand model → **inference-first (burn-rate), evolving to per-procedure templates behind one interface** (R-PDF-1).
- Student undo carve-out → **no carve-out; students get undo like everyone** (§9).

**Still open / gated:**
- **massive-03** (clinic network) + **medium-04** (asset copilot/voice) — **on hold, no deadline** (owner). Blockers unchanged: buyer identity + security design pass (massive-03); native-shell sequencing for voice (medium-04).

---

## Appendix A — Finding → phase map (all 36)

- **Phase 0 (HIGH):** 001 R-CB-01 · 002 R-EQ-01 · 003 R-EQ-02 · 004 R-SC-01 · 005 R-RM-01 · 006 R-SY-01.
- **Phase 1 (MED):** 012 R-EQ-03 · 036 R-EQ-04 · 020 R-EQ-05 · 021 R-EQ-06 · 007 R-SH-01 · 017 R-SH-02 · 018 R-IN-01 · 019 R-IN-02.
- **Phase 2 (MED):** 010 R-CB-02 · 011 R-CB-03 · 015 R-SC-02 · 016 R-SC-03 · 013 R-SY-02 · 014 R-SY-03 · 026 R-SY-04 · 008 R-PR-01 · 009/022/023/024/025 R-AD-01..05.
- **Phase 3 (LOW):** 027 · 028 · 029 · 030 · 031 · 032 · 033(web-only) · 034(web-only) · 035(web-only).

## Appendix B — Feature → phase map (all 12)

- **Phase 1:** small-01 R-EQ-F1 · small-02 R-EQ-F2 · small-04 R-EQ-F3 · medium-02 R-SH-F1 · small-05 R-SH-F2 · small-03 R-IN-F1.
- **Phase 2:** medium-01 R-CBF-1 · medium-03 R-BDF-1 · massive-02 R-PDF-1.
- **Phase 4 (gated):** massive-01 · massive-03 · medium-04.

## Appendix C — Grounding status

All 6 HIGH anchors + all 12 feature reuse anchors CONFIRMED on live `main` (2026-07-12). Corrections folded in: (1) 5 of 8 "admin" findings are native-reachable → Phase 2, not deferred (the other 3 are web-only → Phase 3 LOW); (2) `/handoff` already exists → medium-02 extends it; (3) `StatusBadge` already renders icon+text → small-02 preserves + fixes its i18n leak; (4) "one tap" Code Blue → arm→hold-to-confirm; (5) web platform gating threshold = `can("management.web")`.
