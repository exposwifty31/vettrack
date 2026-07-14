# Phase 4 — Gated Massives (parked; entry conditions)

- **Covers:** spec §8 — the owner-gated bets. **On hold, no deadline** (owner).
- **Spec:** `../../superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md`
- **These are not task cards.** Each item is parked with its **standing blocker** and the **entry conditions** that must be met before it earns its own SDD sub-spec (same SDD+TDD+Sonnet contract as `R-M1`). Do not start code until the blocker clears.

> **Note:** massive-01 is nominally a Phase-4 Massive but is **already unblocked and planned** — see `subspecs/R-M1-rfid-gate-e2e.plan.md`. It is not parked here.

---

## massive-03 — Clinic network (equipment sharing + peer benchmarking)

- **Status:** 🚧 on hold. **Standing blocker:** buyer identity — single-clinic vs multi-site (owner decision). Also requires a **dedicated security design pass** before any code.
- **Why gated:** cross-tenant is the **highest-risk surface in the product** — the `clinicId`-on-every-query rule becomes load-bearing. This must not be rushed behind proven single-clinic value.
- **Entry conditions (all required before authoring its sub-spec):**
  1. Owner confirms the **multi-site buyer** is the target (otherwise this stays parked).
  2. A **security design pass** is scheduled and `security-reviewer` is in the loop.
  3. Single-clinic value is proven (the Do-Now/Do-Next features shipped).
- **Reuse anchors (verify at authoring):** multi-tenant `clinicId` + `vt_clinics`; `server/services/equipment-custody-toggle.service.ts` (a transfer is a custody re-home, not a new concept); `server/integrations/` (cross-boundary patterns).
- **New surfaces (sketch):** `vt_clinic_groups`, `vt_clinic_group_members`, `vt_equipment_transfers`; a network panel in the web console + mobile request/accept; new `AuditActionType`s for transfer request/accept/reject.
- **Non-negotiable acceptance bar (the sub-spec must lead with this):** a **negative test** — a clinic **not** in a group can never read another clinic's rows via any network endpoint. Every network read/write must apply **BOTH** (a) an explicit **group-membership check** AND (b) an explicit **target-table `clinicId` filter** constraining rows to the specific clinic set that group grants — **group membership alone does not satisfy tenant isolation; the query must still be `clinicId`-scoped.** Benchmarks enforce **k-anonymity** server-side (suppress below N peers); no raw peer rows ever returned. Security-reviewer sign-off before merge.

---

## medium-04 — Asset Copilot (ops Q&A) + hands-free chaos mode

- **Status:** 🚧 on hold. Split into **two dependent cards** — **medium-04a** (text-command path), gated only by the data-quality sequencing, and **medium-04b** (voice/ASR path), additionally gated on the native shell and dependent on 04a. Both stay **parked/owner-gated**; each earns its own SDD sub-spec when its entry conditions clear (per "When a blocker clears" / spec §2).
- **Why sequenced late (both cards):** answer quality is bounded by data quality — sequence **after** the data-quality wins (small-01 locate, small-02 badge, R-M1 RFID-gate) and the Code Blue packaging, so it answers from trustworthy inputs.
- **Reuse anchors (shared; substantial scaffolding already exists — verify at authoring):** `server/services/asset-copilot-orchestrator.service.ts` + `asset-copilot-resolve.service.ts`; `server/routes/equipment-copilot.ts`; `server/domain/equipment/copilot/{answer.types,ai-safety-validator,citation-validator}.ts`; `server/domain/equipment/evidence/resolver/*`; `docs/PH-01-operational-assistance-during-chaos.md`.
- **Frozen constraints (both cards; the sub-spec must enforce):** citations mandatory (no uncited answers); `clinicId` scoping on every evidence source; the AI-safety validator gates every response (no bypass for new sources); cross-clinic questions never leak another clinic's rows (golden negative test).

### medium-04a — Text-command path (ships first)

- **Standing blocker:** none from the native shell — gated **only** by the data-quality sequencing above; the text copilot is fully useful alone.
- **Entry conditions:**
  1. The Phase 1 data-quality features (small-01 locate, small-02 badge) have shipped — the copilot's answers need them.
  2. Read the **`claude-api` skill** before wiring any LLM provider/model + prompt-caching.
- **Scope:** widen the resolver's evidence sources from equipment-only to **inventory + shifts + schedule**; keep the **mandatory citation + AI-safety validators unchanged** (every answer must cite). Text query in, cited text answer out — no voice surface.

### medium-04b — Voice / hands-free chaos mode (ASR/STT + TTS; after 04a)

- **Standing blocker (voice only):** the native shell — gated on the Expo / native-app sequencing (deferred). **Depends on medium-04a** — voice is a presentation layer over the text path and does not ship before the text path is proven.
- **Entry conditions:**
  1. medium-04a (text path) has shipped and is proven.
  2. The native-shell sequencing has cleared (STT capture + TTS playback require the native shell).
- **Scope:** a native-shell add-on layered over 04a — **STT in, TTS out** — routed through the **same** orchestrator, citations, and AI-safety validator as the text path (no new evidence source beyond what 04a already vetted, no validator bypass).

---

## When a blocker clears

Author the item's sub-spec at `subspecs/<id>-*.plan.md` following the SDD+TDD+Sonnet contract (spec §2), update the index README status, and — for massive-03 — do the security design pass **first**, as a separate deliverable, before any implementation cards.

**Tier (when built):** every card here is **Tier: O +R** (Opus + `code-reviewer` gate). **massive-03 additionally requires a `security-reviewer` gate on every network card** — cross-tenant is the highest-risk surface in the product.
