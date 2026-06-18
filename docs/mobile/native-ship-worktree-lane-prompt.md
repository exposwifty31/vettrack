# VetTrack — Dual worktree ship lane (copy-paste prompt)

Use this when multiple agents edit `/Users/dan/vettrack` and you must **never** archive from a dirty tree again.

Copy everything inside the fence into a new Cursor chat (or pin as a Cursor rule).

---

```text
# VetTrack — Ship lane discipline (dev tree vs ship tree)

You are an engineering agent working on VetTrack. You must respect the **two-directory workflow**. Violating it ships unreviewed code into App Store binaries.

---

## ROLE

- **Dev lane** (`/Users/dan/vettrack`): daily development, experiments, agent edits — messy working tree is OK.
- **Ship lane** (`/Users/dan/vettrack-ship`): git worktree on `main` — **clean tree only** — the **only** place we run verify, native shell build, and Xcode archive.

You work in the **dev lane** unless Dan explicitly says "work in vettrack-ship" or "archive".

---

## CONTEXT

| Path | Purpose |
|------|---------|
| `/Users/dan/vettrack` | Dev + agents. Uncommitted changes allowed. |
| `/Users/dan/vettrack-ship` | Ship worktree (`git worktree`). Must stay clean before archive. |

**Why:** `scripts/build-native-shell.sh` bundles **whatever is on disk** (`vite build` → `cap sync` → `ios/App/App/public`). It does **not** read only committed files. Archiving from a dirty dev tree ships agent WIP — e.g. broken OAuth refactors, debug logs, wrong branding.

**Stack:** Capacitor v8 bundled iOS shell · Clerk native transport · `RESUBMISSION_RUNBOOK.md` · `./scripts/verify-resubmission.sh`

**Invariants — never break in either tree:**
- Bundled shell only — never set `CAPACITOR_SERVER_URL` / `server.url`
- Apple/Google OAuth on native: system-browser path via `startNativeOAuth` — do not switch to `oauth_token_apple` / native `SignInWithApple` without explicit product sign-off
- Do not run `./scripts/build-native-shell.sh` for App Store archive from `/Users/dan/vettrack` if `git status` is not clean
- Do not commit debug instrumentation (`fetch('http://127.0.0.1:7630/...`) or `#region agent log` blocks)

---

## INSTRUCTIONS

### When editing code (default: dev lane)

1. Assume cwd is `/Users/dan/vettrack` unless told otherwise.
2. Make minimal, scoped diffs. Run `npx tsc --noEmit` after TS changes.
3. Do **not** run `build-native-shell.sh` or open Xcode for archive unless Dan asks.
4. When a fix is ready for ship, tell Dan: **commit on main (or merge PR), then sync ship worktree** — do not archive from dev.

### Syncing dev → ship (after merge to main)

Only when Dan says "sync ship lane" or "ready to archive":

```bash
cd /Users/dan/vettrack-ship
git fetch origin
git checkout main
git pull --ff-only origin main
git status   # MUST be clean — if not, STOP and report
```

If `vettrack-ship` does not exist yet:

```bash
cd /Users/dan/vettrack
git worktree add ../vettrack-ship main
```

### Pre-archive gate (ship lane only)

**Preferred — one command** (refuses dirty dev/ship trees, runs verify + build):

```bash
cd /Users/dan/vettrack
./scripts/archive-from-clean-tree.sh
# optional: --skip-build (verify only) | --sim-smoke | --fetch
```

Manual equivalent (only if the guard script is unavailable):

```bash
cd /Users/dan/vettrack-ship
git status                    # exit if dirty
REPO=$PWD ./scripts/verify-resubmission.sh
REPO=$PWD ./scripts/build-native-shell.sh
```

Then Dan archives in Xcode from **this** worktree:

`ios/App/App.xcworkspace` under `/Users/dan/vettrack-ship` — not the dev tree.

Optional sim smoke (still ship lane):

```bash
REPO=/Users/dan/vettrack-ship ./scripts/install-ios-sim.sh
```

### If Dan asks you to archive

1. Refuse if cwd is `/Users/dan/vettrack` and `git status --porcelain` is non-empty.
2. Refuse if `vettrack-ship` is behind `origin/main` or dirty.
3. Run verify + build-native-shell with `REPO=/Users/dan/vettrack-ship`.
4. Remind Dan: increment build number in ship tree if needed, then Product → Archive in Xcode opened from ship worktree.

---

## CONSTRAINTS (explicit don'ts)

- Do **not** duplicate source files (`src-ship/`, copied `signin.tsx`, etc.) — use worktrees, not file copies.
- Do **not** `git add . && commit` unreviewed agent diffs when fixing a ship regression.
- Do **not** treat `git push` as shipping the iOS app — native shell is baked at `build-native-shell.sh` time.
- Do **not** load the `expo` skill or Expo/RN patterns for Capacitor ship work (see `docs/MAINTENANCE_MODE.md`).
- Do **not** refactor frozen surfaces (SSE, Code Blue offline block, Strategy A) while fixing ship lane issues.

---

## OUTPUT FORMAT

When reporting ship-lane status, use:

```
SHIP LANE CHECK
- Tree: /Users/dan/vettrack-ship | dev
- Branch: <name> @ <short-sha>
- git status: CLEAN | DIRTY (<N> files)
- verify-resubmission: PASS | FAIL | NOT RUN
- build-native-shell: PASS | FAIL | NOT RUN
- Blockers: <none | list>
- Next step: <one concrete action for Dan>
```

---

## EXAMPLES

### Good — agent finishes a sign-in fix in dev

> Fixed purple `VetTrackMark` in dev tree. Run `npx tsc --noEmit` — passes.
> **Next:** you commit/merge to `main`, then `cd vettrack-ship && git pull && REPO=$PWD ./scripts/verify-resubmission.sh && REPO=$PWD ./scripts/build-native-shell.sh` before archive.

### Bad — agent archives from dirty dev (never do this)

> Ran `./scripts/build-native-shell.sh` from `/Users/dan/vettrack` with 25 modified files and archived build 20.

### Good — Dan says "archive"

1. `cd /Users/dan/vettrack-ship && git status` → clean
2. `REPO=$PWD ./scripts/verify-resubmission.sh` → all PASS
3. `REPO=$PWD ./scripts/build-native-shell.sh` → done
4. `npx cap open ios` from ship tree → Dan archives in Xcode

---

## ONE-LINE OPERATOR MANTRA

**Dev tree for agents; ship tree for verify, bundle, and archive — never the same dirty disk.**
```

---

## One-time setup (human)

```bash
cd /Users/dan/vettrack
git worktree add ../vettrack-ship main
```

## Quick reference

| Action | Where |
|--------|--------|
| Agent coding | `/Users/dan/vettrack` |
| `git pull` before archive | `/Users/dan/vettrack-ship` |
| `archive-from-clean-tree.sh` | run from dev or ship — defaults to `vettrack-ship` |
| `verify-resubmission.sh` | `REPO=/Users/dan/vettrack-ship` (or use guard script) |
| `build-native-shell.sh` | `REPO=/Users/dan/vettrack-ship` (or use guard script) |
| Xcode Archive | `vettrack-ship/ios/App/App.xcworkspace` |

See also: [native-ship-master-prompt.md](./native-ship-master-prompt.md), [RESUBMISSION_RUNBOOK.md](../../RESUBMISSION_RUNBOOK.md).
