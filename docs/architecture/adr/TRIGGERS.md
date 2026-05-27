# ADR required triggers

When a pull request includes any change below, it **must** link an ADR in the PR description (`ADR-NNN` or path under `docs/architecture/adr/`). The ADR must be **proposed** or **accepted** before merge of the implementing PR.

Source: [architecture-hardening-addendum.md](../architecture-hardening-addendum.md) §8.2.

## Trigger table

| If your PR… | ADR required |
|-------------|--------------|
| Introduces or moves a **domain boundary**, or adds **cross-domain DB access** (e.g. tasks code querying inventory tables directly) | Yes |
| Adds a **new BullMQ queue** or changes a **job payload shape** consumed by workers | Yes |
| Adds or changes an **outbox SSE `type`**, replay behavior, or realtime transport semantics | Yes |
| Adds or changes **`PendingSyncType`**, offline replay, or sync-engine semantics | Yes |
| Changes **tenancy** (`clinicId` resolution, membership, dev-bypass, tenant middleware order) | Yes |
| Breaks **repository convention** (e.g. implicit `clinicId`, repositories opening transactions) | Yes |
| Adds a **new external integration vendor** or changes integration isolation contracts | Yes |
| Changes **pilot mode** route registration or effective route surface | Yes |
| Makes a **breaking change** to contracts in `shared/` | Yes |

## Not required (typical)

- Bugfixes with no contract or boundary change
- Copy/i18n-only changes
- Docs-only PRs that do not change architecture
- Refactors that preserve behavior and do not cross triggers above

When unsure, open a short **proposed** ADR — docs-only ADRs are encouraged to be small.

## PR description format

```text
## ADR
- ADR-003 (accepted): docs/architecture/adr/003-example-slug.md
```

Or for a docs-first ADR in the same PR:

```text
## ADR
- ADR-004 (proposed → accepted in this PR): docs/architecture/adr/004-my-change.md
```

## Lifecycle

| Status | Meaning |
|--------|---------|
| **proposed** | Under review; implementation PR may reference it but should not merge until accepted |
| **accepted** | Decision is in force |
| **deprecated** | No longer recommended; kept for history |
| **superseded** | Replaced by another ADR — link the successor |

## Categories (tags)

Use in ADR header: `#tenancy` `#realtime` `#offline` `#clinical-safety` `#billing` `#integrations` `#frontend-state` `#worker`

## Related

- [README](./README.md) — index and how to write ADRs
- [template.md](./template.md) — copy for new ADRs
- Legacy ADRs (pre-folder): [ADR-001](../adr-001-medication-task-models.md), [ADR-002](../adr-002-appointments-service-split.md)
