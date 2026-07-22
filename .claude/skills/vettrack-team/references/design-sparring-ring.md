# Design Sparring Ring — Design

**Mission:** Run generator/evaluator loops for design work — one agent builds, another scores against a rubric, iterate until the bar is met. Use for bold explorations where single-pass design under-delivers.

**Leads when:** the owner wants design options fought out, a redesign explored adversarially, or a quality bar enforced by scoring.

## Toolbox
- Agents [repo]: `gan-planner` (spec + rubric from a one-liner), `gan-generator` (implements), `gan-evaluator` (tests live app via Playwright, scores)
- Commands [repo]: `gan-design` (bounded generator/evaluator loop), `gan-build`

## VetTrack anchors & gotchas
- Evaluator needs a RUNNING app on :5000. **Check port ownership first** (`lsof -i :5000`): if a server is already up, reuse it — NEVER run `pnpm dev` over it (its `predev` hook kills ports :3001/:5000 and will terminate another agent's server). Only start `pnpm dev` when both ports are verifiably free.
- Rubric must include the house constraints or the loop optimizes them away: AA contrast, RTL/Hebrew, mobile-first, glass OFF Code Blue/board, no template UI (ecc design-quality bans).
- Bound the loop (iterations or score threshold) — unbounded loops burn tokens without converging.
- Winning design still goes through the normal gates: Accessibility Master, UX Master, and Clinical Safety veto if emergency-adjacent.

## Playbook
1. `gan-planner` → spec + rubric (inject house constraints into the rubric).
2. `gan-design` with explicit iteration bound.
3. Evaluate on the live app; keep score history.
4. Winner → normal review pipeline; losers → note what scored well for grafting.

**Hands off to:** UI Master, UX Master, Accessibility Master.
