# VetTrack documentation

Entry point for engineers, operators, and agents. **Canonical remote:** GitHub `origin` (`exposwifty31/vettrack`). **CI:** GitHub Actions (`.github/workflows/`).

---

## Start here (read before coding)

| Doc | Purpose |
|-----|---------|
| [../README.md](../README.md) | Quick start, stack overview |
| [../CLAUDE.md](../CLAUDE.md) | Engineering rules, frozen surfaces, commands |
| [../AGENTS.md](../AGENTS.md) | Agent session protocol |
| [../PLAN.md](../PLAN.md) | Current sprint scope |
| [../TASKS.md](../TASKS.md) | Task queue and acceptance criteria |
| [CONVENTIONS.md](./CONVENTIONS.md) | Naming, patterns, error handling |
| [**scope-change-2026.md**](./scope-change-2026.md) | **Required** — removed features (migrations 142–143), redirects |
| [MAINTENANCE_MODE.md](./MAINTENANCE_MODE.md) | Repo vs literate-dollop; ship lane; Capacitor 1.0.1 |
| [testing-guide.md](./testing-guide.md) | Test suites, exclusions, when to run what |
| [../BUG_REGISTER.md](../BUG_REGISTER.md) | Known defects |

---

## Active program (intent — not all built)

Forward-looking per-role UX, web management console, Command Center as fourth platform. Treat as direction; verify against code before assuming shipped.

| Doc | Purpose |
|-----|---------|
| [design/program-plan.md](./design/program-plan.md) | Master program plan (phases 0–10) |
| [design/plan-validation-register.md](./design/plan-validation-register.md) | Phase R — cited assumption register |
| [design/platform-strategy-research.md](./design/platform-strategy-research.md) | Platform strategy + per-phase playbooks |
| [design/web-management-brief.md](./design/web-management-brief.md) | Web console IA brief (Claude Design input) |
| [design/web-console-mockup-audit-2026-07-07.md](./design/web-console-mockup-audit-2026-07-07.md) | Management Home mockup audit (blockers + inheritance) |
| [design-system.md](./design-system.md) | Stage 1 tokens + component conventions |

**Design handoff** (`.dc.html`, previews, synced components): [`design-handoff/stages-full/project/`](./design-handoff/stages-full/project/)

---

## Living audits (program Phase 0+)

Consult before extending existing surfaces. Update in phase PRs.

| Doc | Purpose |
|-----|---------|
| [audit/RELEVANCE_BASELINE.md](./audit/RELEVANCE_BASELINE.md) | Repo relevance baseline |
| [audit/FLOW_INVENTORY.md](./audit/FLOW_INVENTORY.md) | Route × platform × role inventory |
| [audit/PROOF_ALIGNMENT_LOG.md](./audit/PROOF_ALIGNMENT_LOG.md) | Gate evidence — what was actually run |
| [audit/IMPROVEMENT_LOG.md](./audit/IMPROVEMENT_LOG.md) | III.5 improvement queue (owner-routed) |
| [audit/codebase-relevance-classification.json](./audit/codebase-relevance-classification.json) | Per-file classification artifact |
| [audit/HANDOVER.md](./audit/HANDOVER.md) | Session handover notes |
| [audit/WETCHECK_AUDIT_2026-07-05.md](./audit/WETCHECK_AUDIT_2026-07-05.md) | Worktree / origin reconciliation |
| [audit/ORIGIN_RECONCILIATION_2026-07-05.md](./audit/ORIGIN_RECONCILIATION_2026-07-05.md) | Remote branch reconciliation |
| [audit/app-ux-review-2026-07-03.md](./audit/app-ux-review-2026-07-03.md) | App UX review snapshot |
| [audit/today-screen-ux-review-2026-07-03.md](./audit/today-screen-ux-review-2026-07-03.md) | Today screen UX review |

### Generated inventories (`pnpm docs:audit`)

| Doc | Purpose |
|-----|---------|
| [audit/routes.md](./audit/routes.md) | API route inventory |
| [audit/frontend-routes.md](./audit/frontend-routes.md) | SPA route inventory |
| [audit/db.md](./audit/db.md) | Schema table inventory |

---

## Setup & local development

| Doc | Purpose |
|-----|---------|
| [setup/environment.md](./setup/environment.md) | Env vars, ports, Postgres, Redis |
| [dev-signin-runbook.md](./dev-signin-runbook.md) | Clerk vs dev-bypass sign-in |
| [devops/github-setup.md](./devops/github-setup.md) | Clone, branch protection, required checks |
| [cloud-agent-starter-skill.md](./cloud-agent-starter-skill.md) | Cloud agent / Railway quickstart |
| [migrations.md](./migrations.md) | Drizzle migration workflow |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Branches, PR flow, release, local gates |

---

## Architecture

| Doc | Purpose |
|-----|---------|
| [architecture/offline-realtime-invariants.md](./architecture/offline-realtime-invariants.md) | **Frozen** — SSE, PWA, Code Blue, outbox |
| [architecture/backend-routing.md](./architecture/backend-routing.md) | API mount registry |
| [architecture/domain-boundaries.md](./architecture/domain-boundaries.md) | Module boundaries |
| [architecture/tenant-enforcement.md](./architecture/tenant-enforcement.md) | `clinicId` multi-tenancy rules |
| [architecture/modularization-status.md](./architecture/modularization-status.md) | Slice progress |
| [architecture/equipment-god-files-split-plan.md](./architecture/equipment-god-files-split-plan.md) | Equipment page decomposition plan |
| [offline-first-architecture-plan.md](./offline-first-architecture-plan.md) | Offline queue / sync sequencing (referenced in code) |
| [architecture/adr/README.md](./architecture/adr/README.md) | ADR index |
| [decisions/](./decisions/) | Lightweight architecture decisions (AD-01, AD-02) |
| [governance/FROZEN_SURFACE_CHANGE_PROTOCOL.md](./governance/FROZEN_SURFACE_CHANGE_PROTOCOL.md) | How to propose frozen-surface changes |
| [governance/ARCHITECTURE_MAP.md](./governance/ARCHITECTURE_MAP.md) | System architecture map |

---

## DevOps & CI/CD

| Doc | Purpose |
|-----|---------|
| [devops/ci-cd.md](./devops/ci-cd.md) | GitHub Actions workflows and local parity |
| [governance/CI_CD_GOVERNANCE.md](./governance/CI_CD_GOVERNANCE.md) | CI/CD governance audit |
| [infra/branch-protection.md](./infra/branch-protection.md) | Branch protection notes |
| [release-runbook.md](./release-runbook.md) | Release promotion |
| [staging-e2e-runbook.md](./staging-e2e-runbook.md) | Staging E2E |
| [playwright-matrix.md](./playwright-matrix.md) | Playwright suite split |
| [demo-rollback.md](./demo-rollback.md) | Emergency demo rollback |

### Runbooks

| Doc | Purpose |
|-----|---------|
| [runbooks/1.4-clerk-key-rotation.md](./runbooks/1.4-clerk-key-rotation.md) | Clerk key rotation |
| [runbooks/activate-admin-email.md](./runbooks/activate-admin-email.md) | Admin email activation |
| [runbooks/inventory-jobs-failed-deductions.md](./runbooks/inventory-jobs-failed-deductions.md) | ⚠️ Historical — medication jobs removed (scope-change) |

---

## Mobile native (Capacitor)

| Doc | Purpose |
|-----|---------|
| [mobile/README.md](./mobile/README.md) | Native ship index |
| [capacitor-native-app.md](./capacitor-native-app.md) | Build and run native shell (`pnpm cap:build:native`) |
| [mobile/release.md](./mobile/release.md) | iOS + Android release steps |
| [mobile/native-ship-checklist.md](./mobile/native-ship-checklist.md) | Pre-ship checklist |
| [mobile/store-metadata.md](./mobile/store-metadata.md) | App Store / Play Store copy |
| [mobile/nfc.md](./mobile/nfc.md) | NFC on native |
| [../RESUBMISSION_RUNBOOK.md](../RESUBMISSION_RUNBOOK.md) | App Store resubmission gates |
| [legal-pages.md](./legal-pages.md) | Privacy / terms / support |
| [account-deletion.md](./account-deletion.md) | In-app account deletion (5.1.1(v)) |

Expo/RN work: [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) — see [governance/LITERATE_DOLLOP_PARITY_REPORT.md](./governance/LITERATE_DOLLOP_PARITY_REPORT.md).

---

## Governance & product

| Doc | Purpose |
|-----|---------|
| [governance/PRODUCT_MODEL.md](./governance/PRODUCT_MODEL.md) | Product model post scope-change |
| [governance/PRODUCT_ALIGNMENT_REPORT.md](./governance/PRODUCT_ALIGNMENT_REPORT.md) | Product/engineering alignment audit |
| [governance/PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md](./governance/PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md) | Prioritized improvement plan (⚠️ some rows pre–GitHub-only cleanup) |
| [governance/ENGINEERING_FRICTION_REPORT.md](./governance/ENGINEERING_FRICTION_REPORT.md) | Engineering friction inventory |
| [governance/EXPO_AGENT_BRIEF.md](./governance/EXPO_AGENT_BRIEF.md) | Cross-repo brief for literate-dollop agents |
| [governance/REPO_CLEANUP_MANIFEST.md](./governance/REPO_CLEANUP_MANIFEST.md) | Repo hygiene (KEEP / UPDATE / DELETE) |
| [engineering-rules-rollout.md](./engineering-rules-rollout.md) | Cursor rules rollout summary |

---

## Integrations & ops

| Doc | Purpose |
|-----|---------|
| [integrations-guide.md](./integrations-guide.md) | External PMS integrations overview |
| [integrations/new-vendor-playbook.md](./integrations/new-vendor-playbook.md) | Onboard a new vendor adapter |
| [integrations/adapter-certification-checklist.md](./integrations/adapter-certification-checklist.md) | Adapter certification |
| [rfid-smoke.md](./rfid-smoke.md) | RFID gateway smoke test |
| [equipment-readiness-rfid-gap-analysis.md](./archive/2026/equipment-readiness-rfid-gap-analysis.md) | RFID gap analysis |

---

## Reference & historical

Pre–scope-change or snapshot docs — read the banner at the top before trusting API/schema rows.

| Doc | Purpose |
|-----|---------|
| [strict-schema-audit.md](./strict-schema-audit.md) | Zod `.strict()` audit (May 2026; medication routes removed) |
| [due-diligence-report.md](./due-diligence-report.md) | Raise readiness tracker (April 2026) |
| [PF-02-hot-route-n1-investigation.md](./audit/PF-02-hot-route-n1-investigation.md) | Hot-route N+1 investigation (TASK-001) |
| [validation/](./validation/) | Phase stabilization reports |
| [evidence/](./evidence/) | Demo / pilot evidence snapshots |
| [program-brain/](./program-brain/) | Pilot-era program brain (historical) |
| [archive/2026/](./archive/2026/) | Archived prompt dumps, GAN harness |

---

## Regenerating inventories

```bash
pnpm docs:audit                                          # routes, frontend-routes, db.md
pnpm routes:contract -- --write-contract                 # after intentional API route changes
pnpm i18n:check                                          # locale parity
```

---

## Not in this tree

| Location | Notes |
|----------|--------|
| `.claude/skills/ecc/` | Third-party ECC skill tooling (includes Python); not runtime app |
| `docs/design-handoff/` | Large design sync tree (~240 files) — entry above |
| Root `PLAN.md`, `TASKS.md`, `DEFINITION_OF_DONE.md` | Process docs live at repo root |
