# Branch protection — `main` and `staging`

Template for the GitHub branch-protection / ruleset configuration of the
VetTrack repository. The Section B infrastructure audit could not read the
live rulesets (the API returned `403` / empty), so the **Actual** columns
below must be filled from an admin export and then reconciled against the
**Expected** baseline.

> This document is descriptive, not enforcing. Branch protection lives in
> GitHub repository settings; nothing in this repo applies it.

## How to export the live configuration

A repo admin runs (or uses the Settings → Rules UI):

```bash
gh api repos/exposwifty31/vettrack/rulesets
gh api repos/exposwifty31/vettrack/branches/main/protection
gh api repos/exposwifty31/vettrack/branches/staging/protection
```

Record the results in the **Actual** columns and open an issue for any row
that does not match **Expected**.

## Expected baseline

### `main` (release branch)

| Setting | Expected | Actual |
|---|---|---|
| Require a pull request before merging | Yes | _tbd_ |
| Required approving reviews | >= 1 | _tbd_ |
| Dismiss stale approvals on new commits | Yes | _tbd_ |
| Require status checks to pass | Yes | _tbd_ |
| Required checks | single **`Merge gate`** status check (CI shards — typecheck · test×4 · build · Playwright×2 — all funnel into it; pin **only** `Merge gate` since the shard names change, per #104) | _tbd_ |
| Require branches up to date before merge | Yes | _tbd_ |
| Require conversation resolution | Yes | _tbd_ |
| Restrict who can push | Maintainers only | _tbd_ |
| Allow force pushes | No | _tbd_ |
| Allow deletions | No | _tbd_ |
| Require linear history | Recommended | _tbd_ |

### `staging` (integration branch)

| Setting | Expected | Actual |
|---|---|---|
| Require a pull request before merging | Yes | _tbd_ |
| Required approving reviews | >= 1 | _tbd_ |
| Require status checks to pass | Yes | _tbd_ |
| Required checks | single **`Merge gate`** status check (CI shards — typecheck · test×4 · build · Playwright×2 — all funnel into it; pin **only** `Merge gate` since the shard names change, per #104) | _tbd_ |
| Require branches up to date before merge | Recommended | _tbd_ |
| Allow force pushes | No | _tbd_ |
| Allow deletions | No | _tbd_ |

## Notes on required status checks

- `ci.yml` runs the `test` job (typecheck + build + migrations + full vitest)
  on PRs targeting `main` and `staging`. Its `gate` job is the single
  merge-gate check to require.
- `playwright.yml` runs as a sharded matrix (`shard 1`, `shard 2`); if
  Playwright is a required check, require **each shard**.
- `release-gate.yml` is **dispatch-only** and runs post-merge semantics — it
  is not a PR-blocking check and should not be added as a required check.

## Reconciliation checklist

- [ ] Export the live rulesets for `main` and `staging`.
- [ ] Fill the **Actual** columns above.
- [ ] File an issue for every Expected/Actual mismatch.
- [ ] Confirm force-push and deletion are disabled on both branches.
- [ ] Confirm the CI merge gate is a required check on both branches.
