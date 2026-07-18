# medium-04 · Asset Copilot for ops questions + hands-free chaos mode

> Tier: Medium · Effort: Medium–High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker (voice only):** voice mode needs the native shell — gated on the Expo /
> native-app sequencing. The text copilot is not blocked. Strategy source:
> [`../session-1.md`](../session-1.md) Medium #7.

## Goal
Natural-language Q&A over custody + inventory + shifts + schedule — *"What do I need to prep
for the 2pm dental?" "Which devices are overdue for calibration?" "Where's the portable
X-ray?"* — plus a hands-free voice mode during a Code Blue.

## Why 10x
Collapses "hunt through screens" into one question, and in chaos gives spoken guidance when
hands are full. In the AI era this is a differentiator competitors can't match without the
underlying data model. **Much is already built** — this is extend + surface.

## Reuse (real anchors — substantial existing scaffolding)
- `server/services/asset-copilot-orchestrator.service.ts` + `asset-copilot-resolve.service.ts`.
- `server/routes/equipment-copilot.ts` — existing copilot endpoint.
- `server/domain/equipment/copilot/{answer.types,ai-safety-validator,citation-validator}.ts`
  — keep the existing citation + AI-safety validators.
- `server/domain/equipment/evidence/resolver/*` — the evidence engine to widen.
- `docs/PH-01-operational-assistance-during-chaos.md` — chaos-mode design notes.

## Approach
1. Widen the resolver's evidence sources from equipment-only to inventory + shifts + schedule.
2. Keep the mandatory citation + AI-safety validators unchanged (every answer must cite).
3. Voice = a native-shell add-on layered later (speech-to-text in, TTS out) — the text path
   ships first and is fully useful on its own.

## New schema / surfaces
- No new tables (retrieval over existing data). A copilot entry point on mobile + console.
- Voice mode: native-shell integration (deferred).

## Frozen constraints
- **Citations mandatory** (existing validator) — no uncited answers.
- `clinicId` scoping on every evidence source.
- AI-safety validator must gate every response (no bypass for new sources).

## Verification
- A golden Q/A set returns cited answers across the new source types.
- Out-of-scope / unanswerable questions refuse safely (validator path).
- Cross-clinic questions never leak another clinic's rows.

## Effort / Risk
Medium–High (text); voice adds native work. Risk: answer quality is bounded by data quality —
**sequence after the data-quality wins** (small-01/02, massive-01) so it answers from trustworthy
inputs.

## Open questions
- LLM provider/model + prompt-caching strategy (see the `claude-api` skill before wiring).
- Voice scope — only during Code Blue, or a general hands-free mode?
