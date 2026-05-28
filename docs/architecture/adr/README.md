# Architecture Decision Records (ADR)

Lightweight, versioned decisions for changes that are hard to reverse or cross team boundaries. **G2 governance** — no runtime enforcement; reviewers and the PR template apply this process.

## Quick start

1. Copy [template.md](./template.md) → `docs/architecture/adr/NNN-short-slug.md` (next number: see index below).
2. Fill **Context**, **Decision**, **Consequences**, **Compliance**.
3. Open PR (docs-only ADR PRs are fine).
4. Link `ADR-NNN` from any implementation PR that matches a [trigger](./TRIGGERS.md).

## When an ADR is required

See **[TRIGGERS.md](./TRIGGERS.md)** for the full table (mirrors [architecture-hardening-addendum.md](../architecture-hardening-addendum.md) §8.2).

## Index

| ID | Title | Status | Path |
|----|-------|--------|------|
| ADR-001 | Two medication task models | accepted | [adr-001-medication-task-models.md](../adr-001-medication-task-models.md) (legacy path) |
| ADR-002 | appointments.service.ts decomposition | accepted | [adr-002-appointments-service-split.md](../adr-002-appointments-service-split.md) (legacy path) |

New ADRs use **`docs/architecture/adr/NNN-slug.md`**. Legacy files stay in place until an optional move PR; do not renumber without team agreement.

**Next suggested number:** ADR-003

## Lifecycle

1. **proposed** — draft in PR  
2. **accepted** — merged with or before implementing PR  
3. **deprecated** — historical only  
4. **superseded** — link replacement ADR  

Implementation PRs must reference an **accepted** ADR (or accept the ADR in the same merge).

## Review expectations

- ADR-only PRs: target ≤ 1 business day review  
- Link `ADR-NNN` in implementation PR description  
- Resolve **chatgpt-codex-connector** threads before merge (repo policy)  

## Related docs

- [governance-known-limitations.md](../governance-known-limitations.md) — G3–G5 warn-only pause and false-positive catalog
- [architecture-hardening-addendum.md](../architecture-hardening-addendum.md) §8  
- [modularization-plan.md](../modularization-plan.md)  
- [tooling-syntax-verification.md](../tooling-syntax-verification.md)
