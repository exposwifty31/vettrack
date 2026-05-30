# GitHub Actions troubleshooting

## `startup_failure` with workflow path `BuildFailed`

If Actions shows **Startup failure**, **0s**, empty workflow name, and path `BuildFailed`, the repo has a **stale workflow registration** (usually from a file committed at the repository root named `BuildFailed` instead of under `.github/workflows/`).

Valid workflows live only under `.github/workflows/*.yml`.

### Fix (repo admin — required once per repo)

GitHub has a **deleted** workflow registered at path `BuildFailed` (workflow id `285976531`). It is not in git; it still hooks `push` / `pull_request` and fails with **startup_failure** before **CI — VetTrack** can run.

1. Open [Actions](https://github.com/dboy3156/VetTrack/actions) → left sidebar **All workflows**.
2. Find the nameless or **BuildFailed** workflow (state may show deleted) → **⋯** → **Disable workflow**.
3. On the PR, use **Re-run all jobs** or push a new commit.

Until that workflow is disabled, PR checks may show only `startup_failure` (0s) and not **CI — VetTrack**.

### Feature-branch CI (after ghost is disabled)

`ci.yml` also runs on `push` to `cursor/**` branches and supports `workflow_dispatch` for manual runs.
