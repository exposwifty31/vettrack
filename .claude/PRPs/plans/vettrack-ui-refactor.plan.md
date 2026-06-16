# Plan: VetTrack Clinical Design-System Refresh

> Synthesized from: prp-plan · mobile-design · product-strategist · ui-design-system · ui-ux-pro-max · feature-dev · gan-design.
> Direction: **Restrained clinical** — "Linear/Stripe for a vet hospital." Boldness comes from hierarchy, rhythm, and precision, never decoration.

## Summary
A full, token-driven design-system pass on VetTrack's mobile-first PWA, plus two correctness fixes (Hebrew language purity, bottom-nav overload). The work is sequenced by clinical priority: foundation tokens → navigation shell → equipment & board → home → alerts & emergency.

## User Story
As a Hebrew-speaking vet tech working one-handed under time pressure, I want a calm, precise, fully-Hebrew interface where the most-used actions sit in my thumb's reach and safety-critical state is impossible to miss — so the tool speeds me up instead of fighting me.

## Problem → Solution
- Mixed languages in Hebrew mode → every string i18n-routed (zero hardcoded copy).
- Bottom nav forced into a cramped 7-slot mode that dropped the scan FAB → restore the emphasized 5-slot thumb-zone layout.
- Ad-hoc visual treatment that "evolved" rather than was designed → a documented token system (incl. the missing type scale) applied consistently across the priority surfaces.

## Metadata
- **Complexity**: Large (multi-phase)
- **Source PRD**: N/A (conversational, skill-driven)
- **Visual tone**: Restrained clinical (confirmed)
- **Priority order (confirmed)**: Equipment+Board → Home/Today → Nav shell → Alerts/Emergency
- **Bottom nav**: decided by analysis (see Decision Record below)

---

## Decision Record

### D1 — Bottom nav: restore the emphasized 5-slot layout
**Decision:** `Today · Equipment · [Scan FAB] · Emergency · Menu`.
- **Scan** stays the center, raised FAB — it is the single most-repeated action in an equipment-first product, and the thumb-zone center is the correct home for it (Fitts' Law, mobile-design `touch-psychology`). The legacy renderer already implements this beautifully; the bug was AppShell forcing NAV-driven mode.
- **Emergency** keeps a permanent one-tap slot — rare but life-critical; burying it fails the clinical-safety priority (product-strategist).
- **Alerts, Board, Rooms** move into the slide-out menu. Alerts is safety-relevant, so its unread count surfaces as a **badge on the Menu icon** so warnings are never silently buried.
- **Why not keep NAV-driven mode with 4 items?** That path has no scan FAB. Restoring scan emphasis matters more than literal NAV-array reuse. We extend the NAV-driven renderer to support an emphasized center item instead of running two divergent renderers.

### D2 — Add the missing typographic scale tokens
The token system already has radius, shadow, motion, and a mature cool-neutral color ramp — but **no type-scale tokens**. ui-design-system requires a modular scale. We add `--text-*` tokens (RTL-aware, mobile-first, 16px base to avoid iOS zoom) and a small set of semantic text utilities, then adopt them on the priority surfaces. We do **not** rip out existing inline sizes globally in one pass — adopt per surface as each is touched.

### D3 — Keep both token systems, document the boundary
shadcn HSL tokens and Ivory RGB tokens coexist intentionally (Ivory = chrome/brand, shadcn = component primitives). We document which to reach for; we do **not** attempt a risky unification.

---

## UX Design

### Bottom nav — Before / After
```
BEFORE (AppShell forces NAV-driven, 6 items + menu):
┌────┬──────┬─────┬──────┬─────┬──────┬──────┐
│Home│Equip │Board│Alert │Room │Emerg │ Menu │   grid-cols-7, no scan FAB
└────┴──────┴─────┴──────┴─────┴──────┴──────┘

AFTER (emphasized 5-slot, thumb-zone scan):
┌──────┬──────────┬─────────┬───────────┬────────────┐
│ Today│ Equipment│  ╭───╮  │ Emergency │  Menu •(n) │
│      │          │  │SCAN│  │           │            │
└──────┴──────────┴──╰───╯──┴───────────┴────────────┘
   Board · Rooms · Alerts → slide-out menu (Alerts count → Menu badge)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Bottom nav slots | 7, cramped, no FAB | 5, scan FAB centered | thumb-zone primary action restored |
| Scan access | buried in NAV item | raised center FAB | equipment-first |
| Alerts visibility | own slot | menu + badge on Menu icon | safety preserved, bar decluttered |
| Menu section headers | hardcoded English | `t.layout.nav.*` | localized |
| Restock toasts (×2) | hardcoded Hebrew | i18n keys | passes no-hebrew-in-source test |
| Type sizing | ad-hoc inline | semantic scale tokens | consistency, Dynamic-Type friendly |

---

## Mandatory Reading
| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/components/layout.tsx` | 299,326,933,1041,1093 | i18n fix targets |
| P0 | `src/components/layout.tsx` | 1237-1448 | bottom-nav renderer (both modes) |
| P0 | `src/components/layout/AppShell.tsx` | 31-60 | nav-items source |
| P0 | `src/index.css` | 1-200 | token system; type-scale gap |
| P1 | `src/lib/routes/nav-model.ts` | all | NAV array |
| P1 | `src/lib/i18n.generated.d.ts` | 60-62,1718,2815 | keys already present |
| P1 | `tailwind.config.ts` | fontFamily/tokens | how tokens map |
| P2 | `src/pages/equipment*`, `src/pages/home*`, ward board | — | priority surfaces |

---

## Patterns to Mirror
### I18N_ACCESS
```tsx
const lh = t.layoutHebrew;                 // already declared in layout.tsx
toast.warning(lh.restockSwitchContainerWarning);
toast.error(t.nfc.error.noActiveRestockSession);
{t.layout.nav.operationsSection}
```
### NAV_FILTER (AppShell)
```tsx
const BOTTOM_NAV_IDS = ["today", "equipment", "emergency"]; // scan FAB + menu added by Layout
const bottomNavItems = NAV.filter((n) => BOTTOM_NAV_IDS.includes(n.id));
```
### EMPHASIZED_ITEM (extend NAV-driven renderer)
```tsx
// Layout renders: [items before center] [Scan FAB] [items after center] [Menu]
// Reuse existing legacy FAB JSX (layout.tsx:1302-1354) inside NAV-driven mode.
```
### TOKEN_USAGE
```css
/* index.css :root — ADD type scale (mobile-first, 16px base) */
--text-2xs: 0.625rem;  --text-xs: 0.75rem;  --text-sm: 0.875rem;
--text-base: 1rem;     --text-lg: 1.125rem; --text-xl: 1.375rem;
--text-2xl: 1.75rem;   --text-3xl: 2.25rem;
--leading-tight: 1.2;  --leading-snug: 1.35; --leading-normal: 1.55;
```

---

## Files to Change
| File | Action | Justification |
|---|---|---|
| `src/index.css` | UPDATE | Add type-scale tokens (D2) |
| `src/components/layout/AppShell.tsx` | UPDATE | Restrict to 3 destinations; scan+menu added by Layout |
| `src/components/layout.tsx` | UPDATE | 5 i18n fixes; emphasized center FAB in NAV-driven mode; Menu alert badge |
| `src/pages/equipment*` + ward board | UPDATE | Adopt type scale + spacing rhythm + card hierarchy |
| `src/pages/home*` | UPDATE | Hierarchy, thumb-zone CTAs, urgent-task surfacing |
| Alerts / Code-Blue surfaces | UPDATE | High-contrast safety states |

## NOT Building
- No transport/realtime/PWA changes (frozen surfaces).
- No DB/schema/API/route renames.
- No token-system unification (D3).
- No dark-mode redesign this pass.
- No new fonts.
- No global rip-and-replace of inline sizes — adopt scale per surface.

---

## Step-by-Step Tasks (phased)

### Phase 0 — Foundation (safe, do first)
1. **i18n: 5 string fixes in layout.tsx** — lines 299, 326, 933, 1041, 1093 → i18n refs (keys already exist; types regenerated). VALIDATE: `tsc`, `i18n-no-hebrew-in-source`, `i18n-parity`.
2. **Type-scale tokens in index.css** — add `--text-*` + `--leading-*` (D2). VALIDATE: `tsc`, visual no-op (nothing consumes them yet).

### Phase 1 — Navigation shell (priority #3, but unblocks the bar fix)
3. **AppShell**: filter NAV to `["today","equipment","emergency"]`.
4. **Layout bottom nav**: render emphasized center Scan FAB in NAV-driven mode (reuse legacy FAB JSX), so order is Today · Equipment · [Scan] · Emergency · Menu. Fix grid to 5 cols.
5. **Menu alert badge**: surface Alerts unread count on the Menu icon.
6. **Slide-out menu**: ensure Alerts/Board/Rooms present; localized section headers (from Task 1). VALIDATE: browser at 375px; ≤5 slots; scan FAB centered; Hebrew + English headers.

### Phase 2 — Equipment + Board (priority #1)
7. Adopt type scale + 8pt spacing rhythm; card hierarchy (status-led, scannable); list virtualization check; loading/empty/error states. VALIDATE: contrast AA, touch targets ≥44px.

### Phase 3 — Home / Today (priority #2)
8. Clear hierarchy (scale contrast, not color-only); urgent tasks first; primary CTA in thumb zone. VALIDATE: AA, thumb-zone.

### Phase 4 — Alerts + Emergency / Code Blue (priority #4)
9. High-contrast, unmistakable safety states; respect frozen Code-Blue runtime rules (server-confirmed, no optimistic termination). VALIDATE: AA, no frozen-surface regressions.

---

## Testing Strategy
| Test | Expected |
|---|---|
| `tests/i18n-no-hebrew-in-source.test.ts` | pass (was failing on 2 strings) |
| `tests/i18n-parity.test.ts` | pass |
| `npx tsc --noEmit` | zero errors |
| `pnpm test` | no regressions |
| Browser 320/375/768 | no overflow, ≤5 nav slots, scan FAB centered |
| Contrast | body ≥4.5:1, large ≥3:1 |

## Validation Commands
```bash
npx tsc --noEmit
pnpm test -- tests/i18n-no-hebrew-in-source.test.ts tests/i18n-parity.test.ts
pnpm test
pnpm dev   # manual mobile-viewport verification per phase
```

## Acceptance Criteria
- [ ] Zero hardcoded copy in layout.tsx; Hebrew mode fully Hebrew.
- [ ] Bottom nav ≤5 slots with centered scan FAB; Emergency one-tap; Alerts badge on Menu.
- [ ] Type-scale tokens exist and are adopted on touched surfaces.
- [ ] Priority surfaces meet AA contrast + 44px touch targets.
- [ ] No frozen-surface (realtime/PWA/Code-Blue) regressions.
- [ ] `tsc`, i18n tests, and full suite green.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Emphasized FAB in NAV-driven mode introduces layout math bugs | Med | Med | Reuse proven legacy FAB JSX + grid math |
| Type-scale adoption drifts from existing inline sizes | Med | Low | Adopt per surface, visual diff each phase |
| Touching Code Blue risks frozen contracts | Low | High | Visual-only; no transport/state-machine edits |
| Scope creep across 4 surfaces | High | Med | Strict phase gates; check in after each phase |

## Notes
- Locale keys + regenerated types already in place from prior session.
- Cool-neutral palette already applied in index.css.
- `evolve` skill: N/A to UI work (clusters learned instincts); ran, nothing to apply.
- Implementation proceeds phase-by-phase with a check-in after each, per feature-dev.
