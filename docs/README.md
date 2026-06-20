# VetTrack documentation

Entry point for engineers, operators, and agents working on VetTrack.

## Start here

| Doc | Purpose |
|-----|---------|
| [../README.md](../README.md) | Quick start, stack, frozen architecture summary |
| [../CLAUDE.md](../CLAUDE.md) | Engineering rules for AI-assisted development |
| [../CONTEXT.md](../CONTEXT.md) | Domain language and non-negotiable clinical/ops rules |
| [**scope-change-2026.md**](./scope-change-2026.md) | **Required reading** — removed features (migrations 142–143), redirect map |
| [MAINTENANCE_MODE.md](./MAINTENANCE_MODE.md) | What belongs in this repo vs literate-dollop; remotes; 1.0.1 ship state |

## Setup & agents

| Doc | Purpose |
|-----|---------|
| [setup/environment.md](./setup/environment.md) | Local env vars, ports, auth modes |
| [devops/github-setup.md](./devops/github-setup.md) | **GitHub** clone, branch protection, labels |
| [dev-signin-runbook.md](./dev-signin-runbook.md) | Clerk vs dev-bypass sign-in |
| [cloud-agent-starter-skill.md](./cloud-agent-starter-skill.md) | Cloud agent / Railway runbook |
| [../AGENTS.md](../AGENTS.md) | Cursor Cloud agent instructions |

## Governance & cleanup

| Doc | Purpose |
|-----|---------|
| [governance/REPO_CLEANUP_MANIFEST.md](./governance/REPO_CLEANUP_MANIFEST.md) | Repo hygiene inventory (KEEP / UPDATE / ARCHIVE / DELETE) |
| [governance/PRODUCT_MODEL.md](./governance/PRODUCT_MODEL.md) | Product model post scope-change |
| [governance/GITHUB_GOVERNANCE.md](./governance/GITHUB_GOVERNANCE.md) | GitHub vs GitLab remote audit |
| [governance/CI_CD_GOVERNANCE.md](./governance/CI_CD_GOVERNANCE.md) | CI/CD governance notes |

## Mobile native

| Doc | Purpose |
|-----|---------|
| [mobile/README.md](./mobile/README.md) | Capacitor ship path index |
| [mobile/store-metadata.md](./mobile/store-metadata.md) | App Store / Play Store copy (1.0.1) |
| [capacitor-native-app.md](./capacitor-native-app.md) | Build and run native shell |
| [../RESUBMISSION_RUNBOOK.md](../RESUBMISSION_RUNBOOK.md) | App Store resubmission gates |
| [legal-pages.md](./legal-pages.md) | Privacy / terms / support |
| [account-deletion.md](./account-deletion.md) | In-app account deletion (5.1.1(v)) |

## Architecture & audits

| Doc | Purpose |
|-----|---------|
| [architecture/offline-realtime-invariants.md](./architecture/offline-realtime-invariants.md) | SSE, PWA, Code Blue frozen surfaces |
| [architecture/backend-routing.md](./architecture/backend-routing.md) | API mount registry and route contract |
| [audit/routes.md](./audit/routes.md) | Generated API route inventory (`pnpm docs:audit`) |
| [audit/frontend-routes.md](./audit/frontend-routes.md) | Generated SPA route inventory |
| [audit/db.md](./audit/db.md) | Generated schema table inventory |
| [migrations.md](./migrations.md) | Migration workflow |

## DevOps & runbooks

| Doc | Purpose |
|-----|---------|
| [devops/ci-cd.md](./devops/ci-cd.md) | GitHub Actions CI pipeline |
| [runbooks/](./runbooks/) | Operational runbooks |
| [rfid-smoke.md](./rfid-smoke.md) | RFID gateway smoke test |
| [integrations-guide.md](./integrations-guide.md) | External PMS integrations |

## Legacy (secondary remote)

| Doc | Purpose |
|-----|---------|
| [GITLAB_DEVELOPMENT.md](./GITLAB_DEVELOPMENT.md) | GitLab MR workflow — **legacy**; use GitHub (`origin`) for canonical history |

## Regenerating inventories

```bash
pnpm docs:audit
pnpm routes:contract -- --write-contract   # after intentional API route changes
```

## Python in this repo

VetTrack application code is TypeScript only. Python files exist under `.claude/skills/ecc/` as third-party ECC skill tooling — not part of the runtime app.

## Archive

Historical agent artifacts: [`archive/2026/`](./archive/2026/) (prompt dumps, GAN harness experiments).
