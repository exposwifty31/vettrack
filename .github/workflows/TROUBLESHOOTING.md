# GitHub Actions troubleshooting

## `startup_failure` with workflow path `BuildFailed`

If Actions shows **Startup failure**, **0s**, empty workflow name, and path `BuildFailed`, the repo has a **stale workflow registration** (usually from a file committed at the repository root named `BuildFailed` instead of under `.github/workflows/`).

Valid workflows live only under `.github/workflows/*.yml`.

### Fix (repo admin)

1. Open **Actions** → filter failed runs → open the `BuildFailed` workflow if listed.
2. Use **⋯** → **Disable workflow** (or delete the stray file on `main` if it exists).
3. Re-run checks on the PR (**Actions** → **CI — VetTrack** → **Re-run all jobs**), or push an empty commit.

This does not affect application code; it is GitHub metadata only.
