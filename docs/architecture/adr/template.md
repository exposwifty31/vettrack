# ADR-NNN: Title

| Field | Value |
|-------|--------|
| **Date** | YYYY-MM-DD |
| **Status** | proposed \| accepted \| deprecated \| superseded |
| **Tags** | `#tenancy` `#realtime` `#offline` `#clinical-safety` `#billing` `#integrations` `#frontend-state` `#worker` (pick all that apply) |
| **Supersedes** | ADR-NNN (optional) |
| **Superseded by** | ADR-NNN (optional) |

## Context

What problem or force is driving this decision? Link issues, prior ADRs, and relevant code paths.

## Decision

What we will do. Be specific enough that a reviewer can tell if an implementation PR matches this ADR.

## Consequences

Positive and negative outcomes, including operational and migration impact.

## Compliance

Fitness functions, migrations, or follow-up work required by this decision:

- [ ] `pnpm architecture:gates` (if touching `server/` or `src/` structure)
- [ ] `npx tsc --noEmit`
- [ ] Schema migration + `pnpm db:migrate` (if `server/db.ts` / schema changed)
- [ ] i18n parity (`locales/en.json` + `locales/he.json`)
- [ ] Baseline updates (`.dependency-cruiser-known-violations.json`, `baseline-cycles.json`) if architecture debt changes
- [ ] Codex review threads resolved (if applicable)
