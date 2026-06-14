# Plan: VetTrack UI/UX Redesign — Equipment-First Excellence

## Summary
VetTrack's primary value is equipment tracking — the "I can't believe I worked without this" moment comes from knowing where every piece of equipment is, who has it, and whether it's ready to use, all in under two taps. This plan makes equipment tracking feel frictionless and delightful, while closing 10 confirmed UX debt issues (safety, design system, and polish) and adding a shareable shift summary card that lets staff celebrate their shift's equipment outcomes. Five sprints: design tokens → safety fixes → equipment UX polish + share card → flow redesigns → QA.

## User Story
As a veterinary technician,
I want to track, scan, and return equipment in a few taps — and share a beautiful summary of my shift —
So that I wonder how I ever worked without this app.

## Product Vision
Equipment tracking is the hero. Code Blue is a life-saving safety layer on top of that hero. The redesign reinforces this hierarchy: the equipment board, scan flows, and room views feel premium and native; emergency functions are always accessible but never dominate the non-emergency state.

**The "can't believe I worked without this" comes from:**
1. Knowing at a glance which equipment is out, where, and how long — without asking anyone
2. Checking in and out gear in one scan, zero friction
3. Getting shift stats that make the work feel meaningful and shareable
4. Never hunting for Code Blue access during an emergency

## Problem → Solution
Equipment board rows are too dense for gloved hands → 44pt minimum on all interactive rows. Code Blue buried at /code-blue with no nav entry → Code Blue in bottom nav. Shift summary shared as plain text wall → beautiful PNG card shared via native iOS share sheet. Two visual systems (Ivory + raw zinc) in one app → unified `--emergency-*` token group.

## Metadata
- **Complexity**: Large
- **Source PRD**: N/A (audit-derived)
- **PRD Phase**: N/A
- **Estimated Files**: 17
- **Sprints**: 5

---

## UX Design

### Before (Equipment tracking experience)
```
Staff needs to find equipment:
┌─────────────────────────────────────┐
│  Bottom nav: Home│Equip│Board│Alerts│Rooms │
│                                     │
│  Equipment board: dense rows, 18px  │  ← Too small for gloved hands
│  ┌─────────────────────────────┐    │
│  │ IV pump #3  [18px row]      │    │
│  │ Defibrillator #1 [18px row] │    │  ← Below 44pt iOS minimum
│  └─────────────────────────────┘    │
│                                     │
│  Shift done → Share: plain text     │  ← "Dan · Tasks: 5/6 — VetTrack"
└─────────────────────────────────────┘
```

### After (Equipment tracking experience)
```
Staff needs to find equipment:
┌─────────────────────────────────────┐
│  Bottom nav: Home│Equip│Tasks│🔴CB│Menu │  ← Code Blue always accessible
│                                     │
│  Equipment board: 44pt rows         │  ← Glove-safe, instant scan
│  ┌─────────────────────────────┐    │
│  │ IV pump #3        [44px]    │    │
│  │ Defibrillator #1  [44px]    │    │  ← One tap to scan/return
│  └─────────────────────────────┘    │
│                                     │
│  Shift done → Share: PNG card       │  ← VetTrack branded, Spotify-style
└─────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Equipment board rows | 18px (1.2px/min × 15min) | 44px minimum height | Glove-safe P1 fix |
| Code Blue access | URL or active-session banner | Bottom nav tab always | P0 safety fix |
| CB pre-check buttons | ~36pt touch target | 44pt min-height | Glove-safe P0 fix |
| PWA prompt on emergency | Shows on /code-blue | Suppressed on /code-blue, /crash-cart | P0 fix |
| Shift summary share | `navigator.share({ text })` — plain text | PNG card → `navigator.share({ files })` | Delightful P1 |
| Next Up card stripe | 3px absolute start-0 border | border-s-2 on parent | P2 banned pattern fix |
| Emergency screens | Raw zinc-* classes | --emergency-* tokens | Design unity P1 |
| Shift handoff | Sheet behind header icon | First-class /handoff route | P1 discoverability |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/index.css` | 1-150 | Token definitions — add emergency/offline tokens here |
| P0 | `tailwind.config.ts` | all | Extend colors, motion durations |
| P0 | `src/lib/routes/nav-model.ts` | all | NAV model drives all navigation |
| P0 | `src/components/layout.tsx` | 560-600, 1227-1450 | Bottom nav rendering, BOTTOM_NAV_ICON_MAP |
| P0 | `src/pages/code-blue.tsx` | all | Touch targets, zinc tokens to replace |
| P0 | `src/components/pwa-install-prompt.tsx` | all | Add route suppression |
| P1 | `src/pages/appointments.tsx` | 1-50 | PIXELS_PER_MINUTE, HOUR_ROW_HEIGHT constants |
| P1 | `src/pages/home.tsx` | 150-200 | Next Up card side-stripe, ShiftSummarySheet link |
| P1 | `src/pages/crash-cart.tsx` | all | Zinc tokens to replace |
| P1 | `src/components/shift-summary-sheet.tsx` | 119-143, 261-321 | shareText, handleShare(), PDF share pattern to mirror |
| P1 | `locales/en.json` | 1141-1162 | shiftRecap.* keys — card text comes from here |
| P1 | `locales/he.json` | 1141-1162 | Hebrew mirror — parity required |
| P2 | `src/hooks/use-pwa-install.ts` | all | isStandalone, isIos flags |
| P2 | `src/components/layout/AppShell.tsx` | all | navigationLocked prop |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: src/lib/routes/nav-model.ts:13-18
export const NAV: NavNode[] = [
  { id: "today", labelKey: "nav.today", href: "/home", icon: "Home" },
  { id: "equipment", labelKey: "nav.equipment", href: "/equipment", icon: "Package" },
  // New entry follows same shape:
  { id: "emergency", labelKey: "nav.emergency", href: "/code-blue", icon: "Siren" },
];
```

### TOKEN_PATTERN
```css
/* SOURCE: src/index.css:60-80 (ivory tokens) */
--ivory-bg:       243 241 235;  /* RGB channels for Tailwind opacity support */
--ivory-surface:  255 255 255;
/* Emergency tokens follow same pattern: */
--emergency-bg:      12 12 12;
--emergency-surface: 24 24 27;
```

### TAILWIND_EXTENSION
```typescript
// SOURCE: tailwind.config.ts:52-58 (ivory color mapping)
ivory: {
  bg: "rgb(var(--ivory-bg) / <alpha-value>)",
  surface: "rgb(var(--ivory-surface) / <alpha-value>)",
}
// Emergency follows same pattern:
emergency: {
  bg:      "rgb(var(--emergency-bg) / <alpha-value>)",
  surface: "rgb(var(--emergency-surface) / <alpha-value>)",
}
```

### RTL_PATTERN
```tsx
// SOURCE: src/pages/home.tsx:118-125
// Use logical properties: start/end not left/right
className="absolute inset-y-3.5 start-0 w-[3px] rounded-full"
// NOT: "absolute inset-y-3.5 left-0 w-[3px]"
// For spacing: ps-*, pe-*, ms-*, me-* not pl-*/pr-*/ml-*/mr-*
// border-s-* for left border in LTR, right border in RTL
```

### ROUTE_SUPPRESSION_PATTERN
```tsx
// SOURCE: src/components/pwa-install-prompt.tsx:9-11
if (isStandalone) return null;
// Follow same guard pattern for route suppression:
import { useLocation } from "wouter";
const [location] = useLocation();
const SUPPRESS_ROUTES = ["/code-blue", "/crash-cart"];
if (SUPPRESS_ROUTES.some(r => location.startsWith(r))) return null;
```

### SHARE_WITH_FILE_FALLBACK
```tsx
// SOURCE: src/components/shift-summary-sheet.tsx:303-319
if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
  try {
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "VetTrack Shift Summary" });
      toast.success(t.shiftSummaryPage.reportDownloaded);
      return;
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    // fall through
  }
}
```

### INLINE_STYLES_FOR_CAPTURE
```tsx
// All styles in ShiftShareCard MUST be inline style={{}} — Tailwind classes
// are unreliable in html-to-image DOM clone on iOS WebView.
// Brand hex values (from src/index.css):
// --brand-navy: #16291c  --brand: #1a3d28  --brand-deep: #0f2a18
// --brand-green-bright: #6fd389  --brand-green-mid: #2f9150
```

### I18N_PATTERN
```typescript
// All user-facing copy goes in locales/he.json + locales/en.json
// Access via typed accessor: t.nav.emergency (not string literals)
// Hebrew key goes in he.json FIRST, then en.json
```

---

## Files to Change

| File | Action | Sprint | Justification |
|---|---|---|---|
| `src/index.css` | UPDATE | 1 | Add `--emergency-*`, `--offline-*`, `--shift-active` tokens |
| `tailwind.config.ts` | UPDATE | 1 | Add `emergency.*`, `offline.*` color maps + motion `transitionDuration` |
| `src/pages/home.tsx` | UPDATE | 1 | Replace banned side-stripe on Next Up card |
| `src/lib/routes/nav-model.ts` | UPDATE | 2 | Add `emergency` nav node |
| `src/components/layout.tsx` | UPDATE | 2 | Add Siren to BOTTOM_NAV_ICON_MAP |
| `locales/he.json` | UPDATE | 2 | Add `nav.emergency` key |
| `locales/en.json` | UPDATE | 2 | Add `nav.emergency` key |
| `src/components/pwa-install-prompt.tsx` | UPDATE | 2 | Suppress on /code-blue and /crash-cart |
| `src/pages/code-blue.tsx` | UPDATE | 3 | Touch targets → 44pt, zinc-* → emergency-* tokens |
| `src/pages/crash-cart.tsx` | UPDATE | 3 | zinc-* → emergency-* tokens |
| `src/pages/appointments.tsx` | UPDATE | 3 | PIXELS_PER_MINUTE → min 44px row height |
| `src/components/ShiftShareCard.tsx` | CREATE | 3 | PNG card component with inline styles + brand hex |
| `src/components/shift-summary-sheet.tsx` | UPDATE | 3 | Replace handleShare() with PNG capture + file share |
| `package.json` | UPDATE | 3 | Add `html-to-image` dependency |
| `src/pages/home.tsx` | UPDATE | 4 | Promote ShiftSummarySheet icon to /handoff link |
| `src/app/routes.tsx` | UPDATE | 4 | Add `/handoff` route |
| `src/pages/handoff.tsx` | CREATE | 4 | New first-class shift handoff page |

## NOT Building
- WebSocket replacement for SSE transport (frozen)
- Renaming `vt_appointments`, `/api/appointments`, or `appointmentsPage.*` (frozen)
- Offline queueing for Code Blue mutations (frozen)
- Dark mode redesign (not in scope)
- New backend API endpoints (all changes are frontend-only)
- Glove Mode toggle (deferred initiative)
- New i18n keys for the share card — all text reuses existing `shiftRecap.*` keys
- PDF redesign — the PDF download keeps its current layout
- Animated share card — static PNG only

---

## Sprint 1 — Token Foundation & Quick Wins (1 day)

**Goal:** Establish `--emergency-*` tokens, wire motion tokens to Tailwind, fix the Next Up side-stripe. No visible feature changes — just structural CSS that all later sprints depend on.

### Task 1.1: Add emergency, offline, and shift-active tokens to index.css
- **ACTION**: Insert new token groups into `:root` block in `src/index.css` after the existing Ivory tokens (~line 80)
- **IMPLEMENT**:
```css
/* Emergency surface — replaces all zinc-* in code-blue.tsx and crash-cart.tsx */
--emergency-bg:         12 12 12;
--emergency-surface:    24 24 27;
--emergency-border:     63 63 70;
--emergency-border-md:  82 82 91;
--emergency-text:       244 244 245;
--emergency-text2:      161 161 170;
--emergency-accent:     239 68 68;
--emergency-accent-soft:127 29 29;
--emergency-amber:      251 191 36;

/* Offline / degraded connectivity */
--offline-bg:           254 243 199;
--offline-border:       217 119 6;
--offline-text:         120 53 15;

/* Shift active state */
--shift-active:         22 163 74;
--shift-inactive:       122 138 126;
```
- **MIRROR**: `TOKEN_PATTERN` — RGB channels, no `rgb()` wrapper
- **GOTCHA**: Must be inside `:root { }` block. The `.dark { }` block needs matching overrides — emergency colors stay the same in dark mode (they're already dark).
- **VALIDATE**: `grep -n "emergency-bg" src/index.css` returns 1 result in `:root`

### Task 1.2: Extend tailwind.config.ts
- **ACTION**: Add to `theme.extend.colors` and `theme.extend.transitionDuration`
- **IMPLEMENT**:
```typescript
// After ivory block in theme.extend.colors:
emergency: {
  bg:         "rgb(var(--emergency-bg) / <alpha-value>)",
  surface:    "rgb(var(--emergency-surface) / <alpha-value>)",
  border:     "rgb(var(--emergency-border) / <alpha-value>)",
  borderMd:   "rgb(var(--emergency-border-md) / <alpha-value>)",
  text:       "rgb(var(--emergency-text) / <alpha-value>)",
  text2:      "rgb(var(--emergency-text2) / <alpha-value>)",
  accent:     "rgb(var(--emergency-accent) / <alpha-value>)",
  accentSoft: "rgb(var(--emergency-accent-soft) / <alpha-value>)",
  amber:      "rgb(var(--emergency-amber) / <alpha-value>)",
},
offline: {
  bg:     "rgb(var(--offline-bg) / <alpha-value>)",
  border: "rgb(var(--offline-border) / <alpha-value>)",
  text:   "rgb(var(--offline-text) / <alpha-value>)",
},
// In theme.extend.transitionDuration:
transitionDuration: {
  instant: "var(--motion-instant)",  // 120ms
  quick:   "var(--motion-quick)",    // 200ms
  enter:   "var(--motion-enter)",    // 620ms
},
```
- **MIRROR**: `TAILWIND_EXTENSION`
- **VALIDATE**: `npx tsc --noEmit` zero errors; `bg-emergency-surface` resolves in IDE

### Task 1.3: Fix Next Up card side-stripe in home.tsx
- **ACTION**: Replace the 3px absolute `start-0` stripe with `border-s-2` on the parent element
- **FILE**: `src/pages/home.tsx:163`
- **CURRENT CODE**:
```tsx
<span
  className="absolute inset-y-3.5 start-0 w-[3px] rounded-full bg-gradient-to-b from-[var(--brand)] to-[var(--brand-deep)]"
  aria-hidden
/>
```
- **IMPLEMENT**: Remove the `<span>` stripe entirely. Add `border-s-2 border-[var(--brand)]` to the parent `<section>` at line 161.
- **MIRROR**: `RTL_PATTERN` — `border-s-*` is RTL-safe
- **VALIDATE**: No absolute-positioned stripe element; section has logical border

#### Sprint 1 Definition of Done:
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes
- [ ] `npx tsc --noEmit` zero errors
- [ ] `bg-emergency-surface`, `text-emergency-text` resolve in IDE

---

## Sprint 2 — Safety Fixes (1-2 days)

**Goal:** Code Blue in bottom nav, touch targets to 44pt, PWA prompt suppressed on emergency screens.

### Task 2.1: Add Code Blue to NAV model
- **FILE**: `src/lib/routes/nav-model.ts`
- **IMPLEMENT**:
```typescript
// After { id: "alerts", ... }:
{ id: "emergency", labelKey: "nav.emergency", href: "/code-blue", icon: "Siren" },
```
- **GOTCHA**: `BOTTOM_NAV_ICON_MAP` in `src/components/layout.tsx:~570` maps string names to Lucide components — must add `Siren` there.
- **VALIDATE**: `grep "Siren" src/components/layout.tsx` returns a result in BOTTOM_NAV_ICON_MAP

### Task 2.2: Add Siren to BOTTOM_NAV_ICON_MAP
- **FILE**: `src/components/layout.tsx`
- **IMPLEMENT**: Add `Siren` to the icon map object. Confirm `Siren` is imported from `lucide-react`.
- **VALIDATE**: Bottom nav renders Siren icon for `/code-blue` tab

### Task 2.3: Add i18n keys for nav.emergency
- **FILES**: `locales/he.json` and `locales/en.json`, under `"nav"` object
- **IMPLEMENT**:
  - `he.json`: `"emergency": "חירום"`
  - `en.json`: `"emergency": "Emergency"`
- **VALIDATE**: `pnpm test -- tests/i18n-parity.test.ts` passes

### Task 2.4: Fix Code Blue touch targets to 44pt minimum
- **FILE**: `src/pages/code-blue.tsx`
- **CHANGES**:
  1. Back button (~line 96): `h-9` → `h-11`
  2. Pre-check item buttons (~line 148): Add `min-h-[44px]`
  3. Manager picker buttons (~line 59): Add `min-h-[44px]`
  4. Quick-log preset buttons (~line 238): `p-2.5` → `p-3 min-h-[44px]`
  5. Note submit Button (~line 257): Add `h-11`
- **MIRROR**: `RTL_PATTERN` — back button uses `ArrowRight` icon (RTL-correct, keep it)
- **VALIDATE**: `grep -n "h-9\|h-8\|h-7" src/pages/code-blue.tsx` returns no results

### Task 2.5: Suppress PWA install prompt on emergency routes
- **FILE**: `src/components/pwa-install-prompt.tsx`
- **IMPLEMENT**: Add after imports, before all other logic:
```tsx
import { useLocation } from "wouter";
// inside PwaInstallPrompt():
const [location] = useLocation();
const EMERGENCY_ROUTES = ["/code-blue", "/crash-cart"];
if (EMERGENCY_ROUTES.some(r => location.startsWith(r))) return null;
```
- **GOTCHA**: `startsWith` covers sub-routes like `/code-blue/display` automatically
- **VALIDATE**: Navigate to `/code-blue` — PWA prompt absent. Navigate to `/home` — PWA prompt still fires.

#### Sprint 2 Definition of Done:
- [ ] Code Blue tab visible in bottom nav on mobile viewport (375px)
- [ ] All Code Blue interactive elements ≥44pt
- [ ] PWA prompt suppressed on /code-blue and /crash-cart
- [ ] `pnpm test` passes; `npx tsc --noEmit` zero errors
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes

---

## Sprint 3 — Equipment UX Polish + Shift Share Card (2-3 days)

**Goal:** Fix equipment task timeline touch targets, unify emergency screens into the design system, and add the shareable shift summary PNG card — the moment that makes staff realize this app is something special.

### Task 3.1: Replace zinc-* with emergency-* tokens in code-blue.tsx
- **REPLACEMENT MAP**:
```
bg-zinc-950          → bg-emergency-bg
bg-zinc-900          → bg-emergency-surface
bg-zinc-900/80       → bg-emergency-surface/80
bg-zinc-800          → bg-emergency-border (as bg for buttons)
border-zinc-700      → border-emergency-border
border-zinc-800      → border-emergency-borderMd
text-zinc-200        → text-emergency-text
text-zinc-400        → text-emergency-text2
text-zinc-500        → text-emergency-text2/60
hover:bg-zinc-700    → hover:bg-emergency-border/80
```
- **KEEP**: `text-red-400`, `bg-red-700`, `text-amber-200` — these are semantic emergency states, not neutral zinc
- **VALIDATE**: `grep "zinc-" src/pages/code-blue.tsx | wc -l` returns 0

### Task 3.2: Replace zinc-* with emergency-* tokens in crash-cart.tsx
- Same replacement map as 3.1
- **VALIDATE**: `grep "zinc-" src/pages/crash-cart.tsx | wc -l` returns 0

### Task 3.3: Fix equipment task timeline touch targets
- **FILE**: `src/pages/appointments.tsx`
- **CURRENT**: `const PIXELS_PER_MINUTE = 1.2` → 15-min slot = 18px
- **IMPLEMENT**:
```typescript
const MIN_SLOT_HEIGHT_PX = 44;
const PIXELS_PER_MINUTE = Math.max(1.2, MIN_SLOT_HEIGHT_PX / SLOT_MINUTES);
// = max(1.2, 44/15) = 2.93px/min → 15-min slot = 44px (exactly at minimum)
const HOUR_ROW_HEIGHT = PIXELS_PER_MINUTE * 60; // ~176px
```
- **GOTCHA**: Total timeline height increases ~2.4×. Verify the scroll container still works. The horizontal axis (if any) must handle the new height.
- **VALIDATE**: Slot rows are visually ≥44px at 375px mobile viewport

### Task 3.4: Install html-to-image
- **ACTION**: `pnpm add html-to-image`
- **IMPORTS**: `import { toPng } from "html-to-image";`
- **GOTCHA**: Do NOT use `toBlob` directly — convert via `dataUrl → fetch → blob` for maximum iOS WebView compatibility. Set `pixelRatio: 2` for Retina.
- **VALIDATE**: `npx tsc --noEmit` — `toPng` types resolve

### Task 3.5: Create ShiftShareCard component
- **FILE**: `src/components/ShiftShareCard.tsx` (NEW)
- **SIZE**: 390 × 560 CSS px, captured at pixelRatio=2 → 780 × 1120 physical pixels

Card layout (top → bottom):
```
┌──────────────────────────────────┐  bg: linear-gradient(160deg, #0f2a18 0%, #1a3d28 60%, #2f9150 100%)
│  VetTrack          [date]        │  color: rgba(255,255,255,0.6)  font-size: 13px
│                                  │
│  Great shift,                    │  color: #ffffff  font-size: 28px  font-weight: 700
│  [firstName]! 🔥 (if streak > 0) │
│                                  │
│  ┌────────┐ ┌────────┐ ┌───────┐ │  3 stat tiles, bg: rgba(255,255,255,0.10), border-radius: 14px
│  │  83%   │ │  5/6   │ │  12   │ │  value: 26px bold white; label: 10px uppercase rgba(255,255,255,0.6)
│  │Progress│ │ Tasks  │ │ Scans │ │
│  └────────┘ └────────┘ └───────┘ │
│                                  │
│  🔥 4-day streak                 │  only when streak > 0; pill bg: rgba(111,211,137,0.18)
│                                  │  border: 1px solid rgba(111,211,137,0.35), color: #6fd389
│                                  │
│                     — VetTrack   │  footer right-aligned, rgba(255,255,255,0.4)
└──────────────────────────────────┘
```

- **PROPS**:
```tsx
interface ShiftShareCardProps {
  firstName: string;
  date: string;        // "Sunday, 14 June"
  heroPct: number | null;
  tasksDone: number;
  tasksTotal: number;
  scansToday: number;
  streak: number;
}
```
- **MIRROR**: `INLINE_STYLES_FOR_CAPTURE` — every style is inline `style={{}}`, no Tailwind classes, raw hex values
- **I18N**: `t.shiftRecap.statProgress`, `t.shiftRecap.statTasks`, `t.shiftRecap.statScans`, `t.shiftRecap.shareFooter`, `t.shiftRecap.shareStreak(streak)`
- **GOTCHA**: No Hebrew text inline. Add `dir="rtl"` on card root for Hebrew locale layout. Pure presentational — no hooks.
- **VALIDATE**: `npx tsc --noEmit` passes; `heroPct=null` renders "—" not "null%"; `streak=0` hides streak pill

### Task 3.6: Wire ShiftShareCard into ShiftSummarySheet
- **FILE**: `src/components/shift-summary-sheet.tsx`
- **IMPLEMENT**:
```tsx
// Add imports
import { toPng } from "html-to-image";
import { ShiftShareCard } from "./ShiftShareCard";

// Add ref at component top
const shareCardRef = useRef<HTMLDivElement>(null);

// Replace handleShare():
const handleShare = async () => {
  try {
    if (typeof navigator !== "undefined" && navigator.share && shareCardRef.current) {
      const dataUrl = await toPng(shareCardRef.current, { pixelRatio: 2, cacheBust: true });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const filename = `vettrack-shift-${format(new Date(), "yyyy-MM-dd")}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: t.shiftRecap.shareTitle });
        toast.success(t.shiftRecap.copySuccess);
        return;
      }
      await navigator.share({ text: shareText, title: t.shiftRecap.shareTitle });
      return;
    }
    await safeClipboardWriteText(shareText);
    toast.success(t.shiftRecap.copySuccess);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    toast.error(t.shiftRecap.copyError);
  }
};

// Render off-screen in JSX (before closing </>):
{!isLoading && !isError && (
  <div style={{ position: "fixed", left: "-9999px", top: 0, pointerEvents: "none", zIndex: -1 }}>
    <ShiftShareCard
      ref={shareCardRef}
      firstName={firstName}
      date={cardDate}
      heroPct={heroPct}
      tasksDone={tasksDone}
      tasksTotal={tasksTotal}
      scansToday={scansToday}
      streak={streak}
    />
  </div>
)}
```
- **MIRROR**: `SHARE_WITH_FILE_FALLBACK`
- **GOTCHA**: Off-screen card must be in the DOM before `handleShare()` is called — the `!isLoading && !isError` guard ensures this. `cacheBust: true` prevents stale captures.
- **VALIDATE**: TypeScript passes; on iOS tapping Share presents native share sheet with image preview

### Task 3.7: Fix Code Blue session-end error recovery
- **FILE**: `src/pages/code-blue.tsx` — `handleEndSession` error catch
- **IMPLEMENT**: Add `duration: Infinity` to the error toast — session end is a critical clinical action, must not auto-dismiss:
```typescript
toast.error(err.message || t.codeBlue.endSessionFailed, {
  id: "cb-end-failed",
  duration: Infinity,
  action: {
    label: t.common.tryAgain,
    onClick: () => setShowOutcomeModal(true),
  },
});
```
- **VALIDATE**: Error toast persists indefinitely; retry button re-opens outcome modal

#### Sprint 3 Definition of Done:
- [ ] `grep "zinc-" src/pages/code-blue.tsx src/pages/crash-cart.tsx | wc -l` returns 0
- [ ] Task timeline slots ≥44px in mobile view
- [ ] `html-to-image` installed; `ShiftShareCard.tsx` created
- [ ] Tapping "Share shift card" on iOS opens share sheet with image preview
- [ ] `pnpm test` passes; `npx tsc --noEmit` zero errors
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes

---

## Sprint 4 — Flow Redesigns (1-2 days)

**Goal:** Promote shift handoff to a first-class route, completing the "start of shift → during shift → end of shift → share" lifecycle.

### Task 4.1: Create /handoff route and page
- **NEW FILE**: `src/pages/handoff.tsx`
- **IMPLEMENT**: Promote content from `src/components/shift-summary-sheet.tsx` into a full page. Show: shift duration, tasks completed, equipment checked out, medications given, Code Blue events (if any), open items for incoming shift.
- **STRUCTURE**: Follow `home.tsx` page pattern — `<AppShell>`, `<Helmet>`, `max-w-[680px]` container, Ivory palette, `Plus Jakarta Sans` font
- **I18N**: Add `handoff.*` keys to `locales/he.json` + `locales/en.json`
- **VALIDATE**: `/handoff` renders without errors, RTL layout correct in Hebrew

### Task 4.2: Add /handoff to routes.tsx
- **FILE**: `src/app/routes.tsx`
- **IMPLEMENT**:
```tsx
const HandoffPage = lazy(() => import("@/pages/handoff"));
// In AppRoutes:
<Route path="/handoff"><AuthGuard><HandoffPage /></AuthGuard></Route>
```
- **VALIDATE**: Navigating to `/handoff` renders the page without a 404

### Task 4.3: Link home header icon to /handoff
- **FILE**: `src/pages/home.tsx` — `ClipboardCheck` icon button in the header
- **IMPLEMENT**: Change from `onClick={() => setSheetOpen(true)}` to `<Link href="/handoff">` from wouter
- **VALIDATE**: Tapping the handoff icon in home navigates to `/handoff`

#### Sprint 4 Definition of Done:
- [ ] `/handoff` route exists, renders shift data
- [ ] Home header icon navigates to `/handoff`
- [ ] `pnpm test` passes; `npx tsc --noEmit` zero errors
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes (new handoff.* keys)

---

## Sprint 5 — QA Pass (0.5 day)

**Goal:** Full regression verification across all changed surfaces, end-to-end equipment and emergency flows.

### Checklist:
1. [ ] `pnpm test` — all tests pass
2. [ ] `npx tsc --noEmit` — zero errors
3. [ ] `pnpm test -- tests/i18n-parity.test.ts` — parity maintained
4. [ ] Start `pnpm dev`, screenshot: home, code-blue, tasks/equipment board, handoff pages
5. [ ] RTL: toggle Hebrew locale, verify all changed screens
6. [ ] Bottom nav: Code Blue tab visible at 375px mobile viewport
7. [ ] Code Blue: navigate to /code-blue — PWA prompt absent
8. [ ] Touch targets: all Code Blue buttons ≥44px (DevTools mobile emulation)
9. [ ] Task timeline: rows ≥44px at mobile width
10. [ ] Shift share card: tapping Share on iOS → native share sheet with image preview
11. [ ] Shift share card: cancel share sheet → no error toast
12. [ ] /handoff: loads, shows shift data, RTL correct
13. [ ] No `zinc-` classes in code-blue.tsx or crash-cart.tsx
14. [ ] No console errors on any audited screen

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `ShiftShareCard` renders | All props valid | No thrown errors | No |
| `heroPct=null` | null | "—" displayed not "null%" | Yes |
| `streak=0` | 0 | No streak pill in DOM | Yes |
| `streak=3` | 3 | Streak pill visible | No |
| i18n parity | Both locale files | `nav.emergency` key present | No |
| Nav model | NAV array | Includes `{ id: "emergency", href: "/code-blue" }` | No |
| PWA suppression | `location="/code-blue"` | Returns null | Yes |
| PWA suppression | `location="/crash-cart"` | Returns null | Yes |
| PWA suppression | `location="/home"` | Renders normally | No |
| Slot height | `SLOT_MINUTES=15`, `MIN_SLOT_HEIGHT_PX=44` | `PIXELS_PER_MINUTE >= 2.93` | No |

### New Test File
Add `tests/ShiftShareCard.test.tsx` using vitest for the 4 unit tests above.

### Edge Cases Checklist
- [ ] `/code-blue/display` — PWA prompt suppressed (startsWith covers sub-routes)
- [ ] `heroPct === null` — ShiftShareCard shows "—"
- [ ] `tasksTotal === 0` — shows "0/0"
- [ ] `streak === 0` — streak pill hidden
- [ ] User cancels iOS share sheet — `AbortError` caught silently, no toast
- [ ] `toPng` throws non-AbortError — `toast.error(t.shiftRecap.copyError)` shown
- [ ] `isLoading` when Share tapped — `shareCardRef.current` is null, guarded, no crash
- [ ] Desktop Chrome/Firefox — `canShare({ files })` false → text share fallback
- [ ] Long shift handoff — `/handoff` scrolls correctly
- [ ] Hebrew locale on `/handoff` — RTL layout correct
- [ ] Code Blue nav item active state when on /code-blue

---

## Validation Commands

```bash
# Type check
npx tsc --noEmit

# Full test suite
pnpm test

# i18n parity
pnpm test -- tests/i18n-parity.test.ts

# Share card unit tests
pnpm test -- tests/ShiftShareCard.test.tsx

# Token replacement verification
grep "zinc-" src/pages/code-blue.tsx src/pages/crash-cart.tsx | wc -l
# EXPECT: 0

# Touch target check
grep -n "h-9\|h-8\|h-7" src/pages/code-blue.tsx
# EXPECT: no results

# Browser verification
pnpm dev
# Then open http://localhost:5000 in Chrome DevTools mobile emulation (390px)
```

---

## Acceptance Criteria
- [ ] Equipment timeline slots ≥44px — glove-safe
- [ ] Code Blue accessible in ≤1 tap from any authenticated screen
- [ ] All interactive elements on `/code-blue` ≥44×44pt
- [ ] PWA prompt suppressed on `/code-blue` and `/crash-cart`
- [ ] Tapping "Share shift card" on iOS → native share sheet with PNG image
- [ ] PNG shows: VetTrack branding, user's name, date, heroPct%, tasks, scans, streak (when >0)
- [ ] Cancelling share sheet → no error toast
- [ ] No `zinc-*` classes in `code-blue.tsx` or `crash-cart.tsx`
- [ ] `/handoff` route exists, linked from home header
- [ ] Side-stripe removed from Next Up card
- [ ] `nav.emergency` key in both locale files
- [ ] All tests pass, zero TypeScript errors

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bottom nav item count exceeds 5 (crowding) | Medium | Medium | Replace "Board" tab with "Tasks"; move Board to Equipment submenu |
| PIXELS_PER_MINUTE change breaks timeline layout | Medium | Medium | Timeline total height ~2.4× — verify scroll container |
| `toPng` slow on low-end devices | Medium | Low | Add `isCapturing` spinner state to Share button |
| `toPng` fails on iOS WebView | Low | Medium | Catch → fall back to `navigator.share({ text: shareText })` |
| Handoff page needs new API endpoints | Low | High | Use existing `/api/home/dashboard` + `/api/tasks/dashboard` |
| Emergency token replacement misses a zinc class | Medium | Low | Validation command: `grep "zinc-" ... | wc -l` must be 0 |

## Notes
- `ShiftShareCard` is 390 × 560 CSS px at pixelRatio=2 → 780 × 1120 physical pixels — crisp on Retina
- `tailwindcss-rtl` is already installed — `border-s-*`, `ps-*`, `pe-*` all work
- `Plus Jakarta Sans` is the primary font. Hebrew fallback: `Heebo` + `Noto Sans Hebrew`. Not Inter.
- The `ShiftSummarySheet` component can remain as a fallback sheet — do not delete it
- All Code Blue mutations stay online-only. `src/lib/offline-emergency-block.ts` must not be modified.
- `navigationLocked` prop on `AppShell` can be set during active Code Blue sessions to prevent accidental nav — left for a follow-up sprint
- No new audit events or telemetry needed for the share card feature
