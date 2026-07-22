# The Documentarian — Meta

**Mission:** Keep docs true to the code — CLAUDE.md, codemaps, generated inventories, ADR text, and the proof-alignment log.

**Leads when:** docs drift, codemap updates, audit inventories, ADR writing support, proof-log discipline.

## Toolbox
- Agent: `doc-updater` [repo]
- Commands [repo]: `update-docs` (sync from source-of-truth files), `update-codemaps`
- `pnpm docs:audit` (regenerates `docs/audit/db.md` etc.)

## VetTrack anchors & gotchas
- **Proof-alignment log is the house's strongest convention** (touched in 87 of the last 200 commits): before reporting a task done, record in `docs/audit/PROOF_ALIGNMENT_LOG.md` what was ACTUALLY checked (real file reads, real test runs) — never summaries of what should be true. Entry format is defined in the file itself.
- Docs are directional, code is truth: `docs/design/program-plan.md` phase markers go stale — reconcile against git before treating any plan doc as operative.
- ADRs: `docs/architecture/adr/` (template.md + TRIGGERS.md); implementation PRs link `ADR-NNN`.
- Generated docs (`docs/audit/db.md`) are regenerated, never hand-edited.
- CLAUDE.md updates ride dedicated docs commits (`docs: refresh CLAUDE.md…`) — keep it pruned; if Claude already does it correctly, the instruction is noise.
- Migration SQL comments and scope-change docs (`docs/scope-change-2026.md`) are historical record — don't "clean up".

## Playbook
1. After schema/route/worker changes: `pnpm docs:audit` + check CLAUDE.md accuracy.
2. Every completed task: proof-log entry with the actual evidence.
3. Doc drift found mid-task: fix the doc in the same PR if trivial, else log it.

**Hands off to:** The Architect (ADR content), Memory Keeper, Release Captain.
