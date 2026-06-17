# VetTrack — Native Mobile + Desktop Implementation Manual

**Purpose:** Step-by-step operator guide for implementing the locked design and PRP plan, with **which skills to invoke when**.

**Canonical sources (read first):**

| Doc | Role |
|-----|------|
| [Design spec](../superpowers/specs/2026-06-15-native-mobile-desktop-design.md) | Locked decisions |
| [Strategy plan](../../.claude/PRPs/plans/native-mobile-desktop-strategy.plan.md) | Tasks, files, validation |
| [Native ship checklist](./native-ship-checklist.md) | Horizon 0 submit gate |
| [RESUBMISSION_RUNBOOK.md](../../RESUBMISSION_RUNBOOK.md) | Clerk + archive preflight |
| [NFC ship checklist](./nfc-ship-checklist.md) | NFC/deep-link evidence before submit |

---

## How to use this manual

1. **One horizon at a time** — do not start RN bedside (Horizon 3) until Capacitor is App Store approved.
2. **Attach skills explicitly** in Cursor/Claude (e.g. `@diagnose`, `@younger-sister-ui-reviewer`) or say “use the X skill”.
3. **Capacitor feature freeze** is active: only checklist fixes + bugfixes until approval.
4. **Bundled-only iteration:** every Capacitor fix → build → sync → new TestFlight build.

**Superpowers orchestration (any horizon):**

- **executing-plans** — load the PRP plan, execute one horizon, report at checkpoints.
- **verification-loop** — before each TestFlight upload or PR merge.
- **grill-me** / **grill-with-docs** — when a new fork appears; grill-with-docs updates CONTEXT/ADRs.

---

## Skill index (recommended)

### Local — use as-is

| Skill | Path | Use when |
|-------|------|----------|
| **diagnose** | `.agents/skills/diagnose/SKILL.md` | Shift chat keyboard, crashes, repro-first bugs |
| **younger-sister-ui-reviewer** | `.cursor/skills/The Annoying Family/younger-sister-ui-reviewer/SKILL.md` | Page/screen UX verdict before marking checklist PASS |
| **bedside-ux-clinical-ui** | `.agents/skills/bedside-ux-clinical-ui/SKILL.md` | Bedside + emergency routes (tiers 2–3) |
| **make-interfaces-feel-better** | `.claude/skills/ecc/make-interfaces-feel-better/SKILL.md` | Polish PASS bar (spacing, motion, hit areas) |
| **accessibility** | `.claude/skills/ecc/accessibility/SKILL.md` | Manual WCAG 2.2 AA audit per checklist row |
| **frontend-a11y** | `.claude/skills/ecc/frontend-a11y/SKILL.md` | Fixing labels, focus, keyboard traps in React |
| **dev-to-prod-gateway** | `.agents/skills/dev-to-prod-gateway/SKILL.md` | Pre-archive: `validate:prod`, `tsc`, build |
| **verification-loop** | `.claude/skills/ecc/verification-loop/SKILL.md` | Quality gates before upload/submit |
| **asset-inventory-logic** | `.agents/skills/asset-inventory-logic/SKILL.md` | Equipment/NFC/offline scan routes |
| **clinical-enterprise-integrity** | `.agents/skills/clinical-enterprise-integrity/SKILL.md` | Code Blue, offline block, billing/inventory alignment |
| **enterprise-security-multi-tenancy** | `.agents/skills/enterprise-security-multi-tenancy/SKILL.md` | Any API/route touching `clinicId` |
| **mobile-design** | `~/.claude/skills/mobile-design/SKILL.md` | Horizon 1+ RN product/UX principles |
| **code-project-architect** | `.agents/skills/code-project-architect/SKILL.md` | Monorepo layout, `packages/*` boundaries |
| **api-design** | `.claude/skills/ecc/api-design/SKILL.md` | New endpoints (e.g. native push token) |
| **backend-patterns** | `.claude/skills/ecc/backend-patterns/SKILL.md` | Server services for RN consumers |
| **vite-patterns** | `.claude/skills/ecc/vite-patterns/SKILL.md` | Web bundle changes during Capacitor phase |
| **executing-plans** | Superpowers plugin | Run a full horizon from the PRP |
| **tdd** / **tdd-workflow** | `.agents/skills/tdd/` + ECC | `extractApiErrorCode`, sync constants tests |

### Optional accelerators (not your WCAG gate)

| Skill | Path | Note |
|-------|------|------|
| **scan** | `~/.claude/skills/scan/SKILL.md` | Automated a11y hints — you still manual-sign WCAG |
| **diff** | `~/.claude/skills/diff/SKILL.md` | New a11y regressions vs branch |

### External — forked into repo (security-reviewed 2026-06-15)

| Skill | Path | Upstream | Adopt when |
|-------|------|----------|------------|
| **publish-mobile-app** | `.agents/skills/publish-mobile-app/SKILL.md` | [logesh-kumar/publish-mobile-app](https://github.com/logesh-kumar/publish-mobile-app) | Task 0.3 App Review / `fix-rejection` |

**Expo / RN (Horizon 1+):** use [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) — `.agents/skills/expo/` lives there, not in this maintenance repo.

**Forked (2026-06-15):** `.agents/skills/publish-mobile-app/` — see `FORK.md` for security review. Do not edit marketplace originals in place.

---

## Horizon 0 — Capacitor submit (primary focus)

**Gate:** 100% [native-ship-checklist.md](./native-ship-checklist.md) green · TestFlight build ≥12 · **bundled** shell only.

### Task 0.1 — Shift chat keyboard (start here)

**Files:** `src/features/shift-chat/components/ShiftChatPanel.tsx`, `ShiftChatFab.tsx`

| Step | Action | Skill |
|------|--------|-------|
| 1 | Reproduce on device: open chat, focus input, keyboard covers send field | **diagnose** |
| 2 | Implement fix (`@capacitor/keyboard`, `visualViewport`, sheet height) | **diagnose** → **frontend-a11y** |
| 3 | Review tap targets, overlap with FAB/close | **younger-sister-ui-reviewer** |
| 4 | Build bundled TestFlight candidate | See [Bundled loop](#bundled-testflight-loop) |
| 5 | Mark tier-1 checklist rows PASS | [native-ship-checklist.md](./native-ship-checklist.md) |

**Example prompt:**

```text
Use @diagnose on shift chat keyboard hiding the input in Capacitor bundled iOS.
Files: src/features/shift-chat/components/ShiftChatPanel.tsx
Goal: keyboard must not hide send input on iPhone and iPad.
```

### Task 0.2 — Checklist burn-down

**Order:** tier 1 (done) → tier 2 bedside → tier 3 emergency → tier 4 platform → tier 5 admin.

| Tier | Routes (summary) | Skills per route |
|------|------------------|------------------|
| 2 | `/home`, `/equipment*`, `/rooms*`, `/alerts`, `/my-equipment` | younger-sister → bedside-ux → make-interfaces-feel-better → accessibility (manual WCAG) |
| 3 | `/code-blue*`, `/crash-cart`, `/handoff` | bedside-ux → **clinical-enterprise-integrity** → accessibility |
| 4 | inventory, analytics, procurement, dashboard | younger-sister → make-interfaces-feel-better → accessibility |
| 5 | `/admin*`, settings, help, audit-log, shift-chat archive | younger-sister → accessibility |

**Equipment / NFC rows:** add **asset-inventory-logic** when testing scan and checkout paths.

**PASS bar (all four layers):**

1. Functional — no crash; primary action reachable  
2. Clinical — ≥44px primary taps; no clipped CTAs; keyboard OK  
3. Polish — spacing/typography acceptable  
4. WCAG 2.2 AA — **manual** sign-off per row  

**Device matrix:** iPhone + iPad · portrait + landscape (four cells per route).

**Example prompt (per route):**

```text
@younger-sister-ui-reviewer review /equipment on iPad landscape in Capacitor.
Checklist: docs/mobile/native-ship-checklist.md tier 2.
Verdict must be SHIPS or list FIX FIRST with file:line.
```

After fixes for a batch of routes:

```text
@make-interfaces-feel-better polish the iPad layout fixes on equipment-list and home pages only.
@accessibility manual WCAG 2.2 AA check for the same routes — document any failures to fix.
```

### Task 0.3 — Submit to App Review

| Step | Action | Skill |
|------|--------|-------|
| 1 | `./scripts/verify-resubmission.sh` + runbook §C demo login | — |
| 2 | [nfc-ship-checklist.md](./nfc-ship-checklist.md) device rows | asset-inventory-logic |
| 3 | `pnpm validate:prod` + `npx tsc --noEmit` + `pnpm build` | **dev-to-prod-gateway**, **verification-loop** |
| 4 | Bundled archive, bump build number, upload TestFlight → Submit | **publish-mobile-app** (optional fork) + runbook §D–§F |
| 5 | On rejection | **publish-mobile-app** `fix-rejection` or **diagnose** + runbook §H |

**Frozen for review:** do not change `capacitor.config.ts` bundled mode, Clerk redirect URLs, or native OAuth chain (runbook §I).

---

## Bundled TestFlight loop

Run after **every** Capacitor UX fix:

```bash
cd /Users/dan/vettrack
./scripts/build-native-shell.sh
# Simulator smoke (optional):
./scripts/install-ios-sim.sh --skip-build   # or full rebuild without --skip-build
# Xcode: bump CURRENT_PROJECT_VERSION → Archive → Upload
```

**Never** use plain `pnpm build && cap sync` for archives — `.env.local` blanks Clerk and ships dev-bypass.

**Never** archive with `CAPACITOR_SERVER_URL` set (runbook + plan).

Before upload:

```bash
./scripts/verify-resubmission.sh
pnpm validate:prod
npx tsc --noEmit
```

See [capacitor-native-app.md](../capacitor-native-app.md) for env split and simulator install.

---

## Horizon 1 — Expo monorepo (literate-dollop only)

**Do not** block Capacitor checklist for this. **Do not** start Horizon 2+ until Capacitor approved.

All Horizon 1+ work runs in [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) (`packages/contracts`, `apps/expo`, `.agents/skills/expo/`). This repo does not host `packages/mobile`.

| Task | Work | Where |
|------|------|--------|
| 1.1 | pnpm workspace, `packages/contracts`, `apps/expo` | literate-dollop |
| 1.2 | Expo Router, `expo-dev-client`, bundle `uk.vettrack.expo` | literate-dollop |
| 1.3 | `@vettrack/contracts` wired into Expo app | literate-dollop |
| 1.4 | NFC config plugin spike (Phase 2+) | literate-dollop |

**Validation (in literate-dollop clone):**

```bash
cd ~/literate-dollop
pnpm install
bash scripts/ci/contracts-gate.sh   # after CI scaffold
```

---

## Horizon 2 — RN auth + API (literate-dollop)

| Task | Work | Where |
|------|------|--------|
| 2.1 | `@clerk/clerk-expo`, `vettrack://`, production Clerk | literate-dollop |
| 2.2 | API client + `EXPO_PUBLIC_API_ORIGIN`; test clinic only | literate-dollop |
| 2.3 | Auth gates (pending/blocked); role from `/api/users/me` | literate-dollop |

**RN dev rule:** production API + production Clerk + **dedicated test clinic/user** — no dev-bypass on RN.

---

## Horizon 3 — Bedside vertical slice

| Task | Work | Skills |
|------|------|--------|
| 3.1 | SQLite offline queue; `@vettrack/shared-client` constants | **asset-inventory-logic**, **clinical-enterprise-integrity** |
| 3.2–3.3 | NFC read, equipment scan UI | **asset-inventory-logic**, **mobile-design**, **make-interfaces-feel-better** |
| 3.4 | Tablet split layout | **mobile-design**, **bedside-ux-clinical-ui** |
| 3.5 | Bottom nav subset | **younger-sister-ui-reviewer** |

E2E (post-H3): ECC **e2e-testing** or Maestro (external).

---

## Horizons 4–7 (summary)

| Horizon | Work | Skills |
|---------|------|--------|
| **4** SSE + APNs | `realtime.ts` port, `POST /api/push-subscriptions/native` | **clinical-enterprise-integrity**, **api-design**, **backend-patterns** |
| **5** Parity waves | `docs/mobile/rn-parity-matrix.md` | **executing-plans**; W4 kiosk **web only** — no RN |
| **6** Mobile web banner | `<1024px` when **RN W1** parity; exempt `/display` | **frontend-patterns**, **vite-patterns** |
| **7** Capacitor removal | RN store cutover; delete `ios/` after **2 release cycles** | **verification-loop**, **superagent-cleaner** |

**EAS Update:** preview/dev channels until RN production; then production OTA for **JS-only** changes.

---

## Frozen contracts checklist (every PR)

Before merging Capacitor or RN client changes:

- [ ] `classifyEmergencyEndpoint` — Code Blue never queued offline  
- [ ] Sync constants match `@vettrack/shared-client` / `sync-engine.ts`  
- [ ] SSE: no WebSockets; KEEPALIVE routing unchanged on web  
- [ ] `clinicId` on every tenant query (server)  
- [ ] Hebrew copy only in `locales/*.json`  
- [ ] No new mobile-facing features during Capacitor freeze (H0)  

Use **clinical-enterprise-integrity** for a second pass on clinical/financial paths.

---

## Weekly rhythm (solo maintainer)

| Day | Capacitor (primary) | RN (secondary) |
|-----|---------------------|----------------|
| Mon–Fri | One tier or route batch → bundled TestFlight → update checklist | 0–2h: Horizon 1 scaffold only if checklist moving |
| Pre-upload | verification-loop + dev-to-prod-gateway | — |
| Blocked on decision | grill-me or grill-with-docs | — |

**Anti-patterns:**

- Starting Horizon 3 while checklist incomplete  
- Remote WebView for archive submission  
- Hiding shift chat to “pass” review  
- New admin features on mobile during freeze  
- RN landscape ward kiosk (locked: web only)  

---

## Quick reference — example session prompts

**Horizon 0 shift chat:**

```text
/diagnose Capacitor iOS shift chat keyboard covers input in ShiftChatPanel.
Implement minimal fix. Then @younger-sister-ui-reviewer on the same components.
```

**Horizon 0 route batch:**

```text
Implement iPad landscape fixes for /home and /equipment per native-ship-checklist tier 2.
Use @make-interfaces-feel-better. Manual WCAG per @accessibility.
Bundled build instructions in docs/mobile/native-mobile-implementation-manual.md.
```

**Horizon 1 scaffold:**

```text
@executing-plans implement Horizon 1 only from
.claude/PRPs/plans/native-mobile-desktop-strategy.plan.md
Use @code-project-architect for workspace layout. iOS + Android Expo dev build.
```

**Pre-submit:**

```text
@dev-to-prod-gateway + @verification-loop — ready for TestFlight archive?
Check native-ship-checklist 100% and verify-resubmission.sh.
```

---

## Document maintenance

When grill-me or plan decisions change:

1. Update [design spec](../superpowers/specs/2026-06-15-native-mobile-desktop-design.md)  
2. Update [strategy plan](../../.claude/PRPs/plans/native-mobile-desktop-strategy.plan.md)  
3. Adjust this manual’s skill table if skills are forked into `.agents/skills/`  

**Last aligned with:** grill-me session 2026-06-15 · native shell scripts 2026-06-15.
