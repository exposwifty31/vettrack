# Implementing the VetTrack Design Pass (27 screens) — Layer 1 of the master plan

## Context

The user commissioned a Claude Design pass ("VetTrack ICU Design Audit" project,
`claude.ai/design/p/9ef590ff-f089-48bf-a247-cd678bdd7ca4`, file `VetTrack Design Pass.dc.html`) that
turned out to be much larger than first understood. `DesignSync`'s `get_file` silently truncates at
256 KiB with no offset/range parameter, so early fetches only surfaced the tail of the file — 9 of the
real 27 turns. A complete local export (2,271,175 chars) revealed the true scope: **27 numbered "turns,"
each a fully mocked screen** (real Hebrew RTL content, states, and for the 2.0 turns a written
spec/findings block).

Turns split into two very different bodies of work:
- **Turns 1–17: a from-scratch visual refresh of every screen the shipping app already has** (Home,
  Equipment List/Detail, Code Blue, Alerts, Crash-Cart Check, Scan, My Equipment, Rooms, Tasks,
  Settings, Profile, 3 iPad workspace variants, TV Board, Web console). Confirmed this is **not** the
  owner's previously-parked Liquid Glass track — no `backdrop-filter`/glass CSS tokens anywhere in the
  file; it's a distinct clinical/ivory + indigo palette. Not yet reconciled with any existing repo plan.
- **Turns 18–27: the VetTrack 2.0 net-new feature screens** — map directly onto
  `docs/vettrack-2.0-roadmap.md` tasks 1.1 (Autopilot approval queue), 1.2 (Case Spine timeline), 1.3
  (Android platform shell), 2.1 (Attach-to-case pin), 0.4 (Autopilot policy console), 2.3 (Who's on the
  floor), 2.2 (Live Floor + Baton), 2.4 (ROI Ledger), 2.5 (Enforce + Safety Net), and Task 1.4
  (Consumable-Usage Capture). Task 2.3 is already architecture-resolved in
  `docs/plans/2.0/task-2.3-who-on-floor.md`.

Real-world timing check (via `asc status --app 6778937527`, live App Store Connect data): build 26 /
v1.2.0 review is **COMPLETE**, App Store version **READY_FOR_DISTRIBUTION**, submission `inFlight: false`,
0 blockers. The resubmit is no longer in flight, which was the standing precondition for starting new
visual-refresh work per the Liquid Glass memory — satisfied.

**Owner decisions:**
1. Turns 1–17 are **not** greenlit as a committed 17-screen program up front — each screen gets an
   explicit go-ahead before implementation ("check with me screen-by-screen").
2. When a screen IS greenlit, the **order** is: non-frozen 1.0 screens first (Home → Equipment List →
   Equipment Detail → My Equipment → Rooms → Tasks → Settings → Profile → Scan → Alerts → Crash-Cart
   Check → the 3 iPad workspace variants → Web console), frozen/high-risk surfaces last within that
   group (Code Blue, TV Board — cosmetic-only, never touching mutation/transport semantics), **then**
   the 2.0 feature tasks continue in their existing roadmap dependency order, picking back up at 2.3.

## Step 0 — Fix self-serve access to the design file

Every turn's section is well under the 256 KiB `get_file` cap on its own (largest ~66 KB). Split the
single 2.27 MB `VetTrack Design Pass.dc.html` in the `claude.ai/design` project into 27 per-turn files
(e.g. `turns/01-home-today.html` … `turns/27-consumable-capture.html`), sourced from the local standalone
export already on hand — not by re-fighting the 256 KiB `get_file` cap. Keep the original file as-is.
Uses `DesignSync`'s `finalize_plan` → `write_files` path, which needs its own explicit permission prompt
(a write into the user's claude.ai/design project) — separate from approving this plan.

## Per-screen workflow (repeats for every one of the 27 screens)

For each screen, in the order above, once individually greenlit:

1. **Extract** that turn's section — mockup markup, any `SPEC / FINDINGS` block (present on 2.0 turns,
   absent on 1–17), and the real Hebrew copy to use verbatim.
2. **Map to the real file:**

   | Turn | Screen | Real file |
   |---|---|---|
   | 1 | Home/Today | `src/pages/home.tsx` |
   | 2 | Equipment List | `src/pages/equipment-list.tsx` |
   | 3 | Equipment Detail | `src/pages/equipment-detail.tsx` |
   | 4 | Code Blue ⚠️ frozen | `src/pages/code-blue.tsx` |
   | 5 | Alerts | `src/pages/alerts.tsx` |
   | 6 | Crash-Cart Check | `src/pages/crash-cart.tsx` |
   | 7 | Scan | `src/pages/scan.tsx` |
   | 8 | My Equipment | `src/pages/my-equipment.tsx` |
   | 9 | Rooms | `src/pages/rooms-list.tsx` (+ `room-radar.tsx`) |
   | 10 | Tasks | `src/pages/Tasks.tsx` |
   | 11 | Settings | `src/pages/settings.tsx` |
   | 12 | My Profile | `src/pages/my-profile.tsx` |
   | 13–15 | iPad workspaces | `src/native/tablet/*` (`TwoPaneLayout`, `RoomsMasterDetail`, etc. — turn 15's Tasks Scheduler master-detail doesn't exist yet, confirm during that screen's own mapping) |
   | 16 | TV Board ⚠️ frozen-adjacent | `src/features/command-board/components/CommandBoard.tsx` + `src/board/BoardShell.tsx` |
   | 17 | Web console | `src/desktop/WebShell.tsx` + relevant `/admin/*` pages |

   Turns 18–27 (the 2.0 features) have no existing page — each needs its own breakdown doc under
   `docs/plans/2.0/` per the roadmap's "breakdown-first" convention (already done for 2.3; still needed
   for 1.1's UI, 1.2, 2.1, 0.4, 2.2, 2.4, 2.5, and Task 1.4).
3. **Compose from the real design system**, not ad hoc markup — reuse synced components in
   `.design-sync` / `src/components/ui`, `src/native/*`, `src/desktop/*`; only add a new component when
   nothing fits.
4. **i18n both locales** — new/changed strings into `locales/he.json` + `en.json` (Hebrew first), via
   the typed `t.*` accessor. `pnpm i18n:check` must stay green.
5. **RED → GREEN** — failing test first for any new logic/component, then implement.
6. **Visual evidence** — screenshots at 320/768/1024 (+ board kiosk scale where relevant), Hebrew AND
   English, light (+ dark where themed). For turns 4 and 16, confirm nothing touches the frozen
   semantics in `CLAUDE.md` (SSE/outbox transport, Code Blue online-only mutation + no offline queueing
   + server-confirmed end, emergency-endpoint cache denylist) — a re-skin only.
7. **Gate** — `pnpm typecheck`, relevant test suite, `pnpm i18n:check`; `pnpm architecture:gates` if a
   module boundary is touched; native screens get `pnpm cap:build:native` + simulator check.
8. **Evidence log + review** — `docs/audit/PROOF_ALIGNMENT_LOG.md` entry with real command output;
   independent fresh-context review of the diff before the screen counts as done.
9. **Commit** — one commit per screen, new commits only.

## Risk notes carried into every relevant screen

- **Code Blue (turn 4) and TV Board (turn 16):** `CLAUDE.md`'s frozen-surface list applies —
  cosmetic/layout changes only.
- **iPad workspaces (13–15):** must stay real master-detail compositions (`useIsNativeTablet` /
  `TwoPaneLayout`), not a scaled-up phone layout.
- **Web console (17):** sits behind `WebOnlyGuard` / admin-lead gating — the redesign doesn't touch
  that gate.
- **Turns 18–27:** continue the dependency chain already established in `docs/vettrack-2.0-roadmap.md`
  — a screen's mock existing doesn't mean its backend does.

## Verification (end to end, per screen)

- `pnpm typecheck` (frontend + server tsconfigs) → 0 errors.
- Relevant `pnpm test` suite for anything with new logic.
- `pnpm i18n:check` — unconditional.
- Live check in the running app: `pnpm dev`, browser (or simulator) at the breakpoints/locales above,
  screenshots as the evidence artifact.
- `docs/audit/PROOF_ALIGNMENT_LOG.md` entry citing the actual commands run and their output.

## Immediate next step

Bring the first screen (Home/Today, turn 1) for an explicit greenlight per the "screen-by-screen"
decision before touching any code.
