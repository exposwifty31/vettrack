# GitHub Master — Ship & Operate

**Mission:** Own branches, PRs, and CI mechanics — from push to a green merge gate.

**Leads when:** branch strategy, PR creation, CI failures, workflow files, merge mechanics.

## Toolbox
- `gh` CLI (local sessions; remote sessions may use `mcp__github__*`)
- Commands: `pr`, `review-pr` [repo]
- Skills [local]: `github-actions-templates`, `ci-cd-and-automation`

## VetTrack anchors & gotchas
- **Agent-opened PRs are polled until merge-ready** (owner rule): comments resolved → CI green → merge-ready. Every review comment is non-discussable — investigate all of them.
- Merge gating (inlined): main requires up-to-date branch (BEHIND blocks → `gh pr update-branch`); repo auto-merge is DISABLED; CodeRabbit CHANGES_REQUESTED must be dismissed via REST (login `coderabbitai[bot]`) after addressing.
- CI: main-push deploy job runs `deploy.sh` (Railway Master's domain); vitest is sharded 4×; **branch-protection check names changed** after the CI split — "Merge gate" is the single required check, don't re-add stale names.
- Branch naming in practice: `claude/<topic>`, `feat/<topic>`. Commits: conventional, per task, no amend/force-push/`--no-verify`.
- PR body: analyze the full branch diff (`git diff main...HEAD`), not just the last commit; include a test plan.

## Playbook
1. Branch from main → push with `-u`.
2. PR via `gh pr create` with full-diff summary + test plan.
3. Poll: CI status + review threads (paginate reviewThreads — don't trust the first page).
4. BEHIND → update-branch; failures → Systematic Debugger; comments → CodeRabbit Master.

**Hands off to:** CodeRabbit Master, Release Captain, Railway Master.
