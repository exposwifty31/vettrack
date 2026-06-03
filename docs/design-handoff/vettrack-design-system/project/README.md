# VetTrack Design System

A design system for **VetTrack** — a mobile-first, offline-capable PWA for veterinary hospital operations. Built for high-pressure ICU shifts: equipment tracking, medication workflows, inventory, scheduling, billing, and external PMS integrations across multi-clinic deployments.

The product surface spans:

- **Marketing site** — public-facing landing page positioning VetTrack as ICU-grade equipment tracking with QR/NFC, offline support, and shift handovers.
- **App (mobile-first PWA)** — the operational product used during active shifts. Hebrew RTL by default, English supported. Includes equipment, alerts, patients, medication tasks, billing, inventory, the ER command center, and Code Blue emergency surfaces.

> **Sources used**
> - **GitHub** — [`dboy3156/VetTrack`](https://github.com/dboy3156/VetTrack) (private) — primary codebase. Explore this for full component implementations, page-level interactions, and the i18n string tables.
> - **Live PWA** — `https://vettrack.uk` — referenced via `index.html` metadata.
>
> If you have repo access, dig deeper. The codebase is canonical; this design system extracts and condenses what's reusable for new design work.

---

## Index

| File / Folder | What's in it |
|---|---|
| `README.md` | This file — overview, content/visual foundations, iconography. |
| `colors_and_type.css` | All color, type, spacing, radius, shadow tokens as CSS variables. **Import this first** for any new artifact. |
| `SKILL.md` | Skill manifest — works both inside this environment and as an Agent Skill for Claude Code. |
| `MOTION_HAPTICS_SOUND.md` | The feel spec — motion timing/easing tokens, haptic patterns, sound rules, and the "earned moment" budget. |
| `assets/` | Brand assets — favicon, PWA icons (192/512), OG image. |
| `preview/` | Specimen HTML cards rendered in the Design System tab (colors, type, spacing, components). |
| `ui_kits/marketing/` | Marketing site UI kit — landing page recreation + reusable hero/feature/CTA components. |
| `ui_kits/app/` | App UI kit — mobile dashboard, equipment list, alerts, plus the desktop PageShell chrome (Topbar + Sidebar). |
| `VetTrack Mobile Prototype.html` | The upgraded app — clickable, themeable (Forest / Clinical / Dark), one-handed. The reference implementation of the current direction. |
| `Pro Pass.html` | Before/after canvas: Magnetic v1 → Pro pass, plus Equipment / Alerts / Recap. |

---

## Content fundamentals

VetTrack copy is **operational and direct**. The product is used during active medical shifts, often one-handed, sometimes mid-emergency. Copy has to land in a glance.

**Tone**
- **Direct, never cute.** Imperatives over invitations: "Add Equipment", "Scan QR", "Continue to Dashboard" — not "Let's get you started!".
- **Outcome-led.** When marketing the product, lead with what it does, not what it is. "Find Critical Equipment in Seconds — Not Minutes" sits at the top of the landing page; specifics ("ICU teams reduce equipment search time by up to 70%") follow.
- **Quietly confident.** No superlatives, no "AI-powered", no "revolutionizing". The product proves itself with concrete capabilities.
- **No emoji.** Status uses colored dots + icons; never `🟢` / `✅` / etc. Emoji appear nowhere in the product or the marketing.

**Voice & person**
- Marketing site is **second-person** ("Add VetTrack to your home screen"). The user is a clinician deciding whether the tool fits their shift.
- In-app copy is **agentless / instructional** — labels, never sentences ("Tracked equipment", "Tasks due now", "Captured this shift"). Buttons are imperative ("Scan QR", "Move", "Export Excel").
- System messages can be **subject-omitted past-tense**: "Checked out — ECG monitor", "Returned — ECG monitor is now available". Reads like a shift log.

**Casing**
- **Title Case for major buttons and section headings** ("Add Equipment", "Inventory Alerts", "Live Activity").
- **Sentence case for descriptions, helper text, and inline hints** ("Mobile-first QR equipment tracking for veterinary hospitals…").
- **UPPERCASE for kickers and small column labels** — set with `letter-spacing: 0.2em` and the `--primary` color ("OUR PLATFORM", "HOW IT WORKS").
- **Numbers are tabular** (`tabular-nums`) wherever they appear in dashboards — counters, time-ago, currency.

**Bilingual realities**
- Default locale is **Hebrew (`he`)**, RTL. English (`en`) is supported at full parity. New copy must ship in both `locales/he.json` and `locales/en.json` (parity is enforced).
- User-facing copy uses **Tasks / משימות** for the unified task model. The underlying `vt_appointments` table / `/api/appointments` route are intentionally *not* renamed — only the rendered string changed (frozen API contract).
- Hebrew text **never** appears in identifiers, variable names, or file names.

**Examples — straight from the codebase**
- Marketing H1: "Find Critical Equipment in Seconds — Not Minutes"
- Marketing subhead: "VetTrack is ready for real ICU use. Log in and start tracking equipment immediately."
- Trust strip: "Secure login · Real-time data · No installation required"
- Quote block: 5-star rating, single line of attribution + a Building2-iconed "Multi-site clinic" tag — no testimonial body padding.
- App KPI cards: "מטופלים פעילים" / "Active patients" — single noun, no verb. Subtitle: "בטיפול פעיל" / "In active treatment".
- System toast: "Checked out — ECG monitor", "Deleted 3 items"
- Empty state: icon + 2-line label ("No alerts" / "All equipment is healthy") — never a paragraph.

**Domain vocabulary (use these exact terms)**
ER Mode · ER Allowlist · Concealment 404 · Intake Event · Clinical onset · Formal intake completion · Accept Patient (intake claim) · In Admission (operational busy) · Queue Severity (low/medium/high/critical) · Primary Lane · Risk Badge · Structured Clinical Handoff · Smart COP · Dose Hard-Stop · Orphan Usage · Code Blue session

(Full glossary lives in `CONTEXT.md` in the source repo — see "Sources used" above.)

---

## Visual foundations

The look is **clinical-warm**: deep forest-green chrome over warm parchment surfaces, with assertive lime-green accents for active states. The two named systems coexist:

- **Ivory neutrals** — warm off-white parchment (`#f3f1eb`) for the page background, white cards, putty-grey borders. This is the surface vocabulary.
- **Forest greens** — deep navy-green (`#0f1f11`) for the global header bar and PWA splash; mid-green (`#1e4a25`) for primary buttons, focus rings, and accent text; a brighter scan-green (`#4cde6a`) only in the logo/QR motifs.

**Color rules**
- **Primary green carries actions.** Buttons, focus rings, active tabs, kicker eyebrows. Hover lightens to `primary/92`.
- **Status uses pale tinted pills**, not solid blocks. Each pill is a dot + label inside a 4px-radius border-fill capsule (`StatusBadge` — see `preview/components-status-badges.html`). The pill is intentionally small — operational density, not Instagram.
- **No bluish-purple gradients.** When gradients appear, they are *soft single-color* (`from-card via-card to-muted/30`) or radial highlights on the marketing CTA (warm white at 20/20%, cool cyan at 80/80%).
- **Reds are reserved for action-required**, never decorative.

**Typography**
- **Plus Jakarta Sans** for everything outside code. Tight tracking on H1 (`-0.025em`) and H2 (`-0.02em`); body is normal. Weights used: 400 / 500 / 600 / 700 / 800.
- **Heebo** (also self-fallback for Hebrew through `Noto Sans Hebrew` and `Rubik`). The stack is `Plus Jakarta Sans, Heebo, Noto Sans Hebrew, Rubik, system-ui, sans-serif` — switching to Hebrew triggers Heebo automatically.
- **IBM Plex Mono** for code, monospaced sublabels in StatCards, and tabular numerics in small chrome.
- **Kickers** are 12px, 600, uppercase, `0.2em` tracking, primary color.

**Spacing & layout**
- Tailwind's 4px scale. Common values: `gap-2 / gap-3 / gap-4` between siblings, `gap-5 / gap-6` between sections.
- Cards use `p-4` (16px) at base density, `p-3` (12px) at compact. Compact density is a global flag (`[data-density="compact"]`) — don't hand-pad to mimic it.
- Mobile content has a `pb-nav-safe` floor (`6rem + safe-area`) so the fixed bottom nav never crops into list rows.

**Radii**
- `0.5rem` (8px) — small chips, icon buttons.
- `0.75rem` (12px) — `--radius`, the base. Buttons, inputs, sheet sections.
- `1rem` (16px) — cards. (`rounded-2xl`)
- `1.25rem` (20px) — feature cards / hero panels.
- `9999px` — pills, chips, status dots.
- StatusBadge uses an outlier `4px` radius — intentional. It's a compressed data-tag, not a button.

**Shadows**
- Two cards of elevation, no more:
  - `shadow-sm` for resting cards, headers, sticky bars.
  - `shadow-md` (or the custom `shadow-card-hover`) for hover — **lifts 1px** with `hover:-translate-y-px` (motion-safe only). The combined micro-lift + shadow shift is the canonical "interactive" cue.
- Primary CTAs add a colored drop shadow: `shadow-lg shadow-primary/25`.
- Status bars and capsules are flat — no shadow.

**Borders**
- Default border `--border` = `hsl(40 12% 81%)` (warm putty). Always `1px` solid. On dark mode it's a desaturated forest grey.
- Hover often shifts border to `border-primary/20` — a soft hint, not a recolor.
- Active filter chips are `bg-primary text-primary-foreground border-primary`; inactive chips are `bg-background text-muted-foreground border-border` with a hover state.
- StatCards use a **3px colored left border** (`border-s-[3px]`) to indicate tone (ok/warn/err/info). This is the only place colored side-borders appear — confine to dashboard tiles.

**Backgrounds**
- App pages: `bg-background` (Ivory parchment). Cards: `bg-card` (white).
- Marketing hero ships a subtle radial mesh: green primary highlight at top-left (`0.12` alpha), a cooler green at top-right (`0.08` alpha), fading to muted background. See `marketing-layout.tsx` for the exact gradient.
- Final CTA section is solid `bg-primary` with two soft radial highlights painted at 40% opacity. The button inside flips colors — `bg-background text-foreground` on green — for maximum punch.
- No image-heavy backgrounds, no hand-drawn illustrations, no repeating patterns. The favicon's nested squares motif (top-left / top-right / bottom-left only — bottom-right deliberately empty) is the *one* abstract motif in the system and reads as a stylized QR finder pattern.

**Animation**
- **Easing**: `ease-out` is the default for entrances, `cubic-bezier(0.34, 1.56, 0.64, 1)` for the bottom-nav active-tab pill (slight overshoot).
- **Duration**: 200ms for hover/state, 220ms for page-enter, 320ms for the pill. Nothing slower except the QR scan-line (1.4s linear, alternating sweep).
- **Page entrance**: `page-enter` keyframe — 4px translateY + opacity. Small enough not to feel like CLS.
- **Hover lift**: `hover:-translate-y-px` paired with `hover:shadow-md`. Active scale-down: `active:scale-[0.97]` (motion-safe).
- **No bounces** outside the bottom-nav pill. No floating particles, no infinite ambient loops in chrome.
- The codebase respects `prefers-reduced-motion`: all keyframes get `animation: none` and the lift transforms become 0. Match this in any new motion work.

**Hover & press**
- Hover: `-translate-y-px` + `shadow-md` for cards/buttons; `bg-muted` for tertiary surfaces; `border-primary/20` for borders.
- Press: `active:scale-[0.97]` (buttons) / `active:scale-[0.99]` (cards). Both gated on `motion-safe:` so reduced-motion users get a clean state change instead.
- Disabled: `opacity-50 saturate-50` + `cursor-not-allowed`.
- Loading: `aria-busy="true"` → `cursor-wait`, plus an inline `Loader2` spinner. The button's label changes from "Move" → "Working…" rather than disappearing.

**Transparency & blur**
- Sticky chrome (marketing header, mobile topbar) uses `bg-background/80 backdrop-blur-xl`. This is the *only* place blur is acceptable.
- Card overlays for hover states use `bg-muted/50`, not blur.
- Final-CTA radial highlights are `opacity-40` over a solid green; the highlights are radial gradients, not blurred shapes.

**Layout rules**
- Mobile bottom nav is fixed; everything else scrolls. A `pb-nav-safe` utility reserves the space.
- Desktop uses an icon sidebar (collapsible) + content area (`PageShell` from `src/components/layout/`).
- Max content width: `max-w-6xl` (1152px) for marketing, fluid for app.
- Touch targets are `min-h-[44px] min-w-[44px]` — enforced globally on buttons, role=button, role=tab, and nav links. Don't shrink them.

**Cards** (the canonical pattern)
- `rounded-2xl border border-border bg-card shadow-card text-card-foreground`.
- Header: `flex flex-col space-y-1.5 p-4` with a title + optional description.
- Content: `p-4 pt-0`.
- Hover variants add `hover:-translate-y-0.5 hover:shadow-md`.
- KPI cards use **only** the standard card frame; tone is communicated by the small icon chip in the corner, not the background.

---

## Iconography

VetTrack uses **`lucide-react`** (v0.446) throughout. No bespoke icon font, no custom SVG set, no Material/Heroicons mix.

- **Stroke**: lucide's default `stroke-width: 2`. The component renders SVGs inline; the system never bundles raster icons.
- **Sizes** (always square): `h-3 w-3` (chip-internal), `h-3.5 w-3.5` (badge / dense), `h-4 w-4` (default in body), `h-5 w-5` (button-leading on lg buttons), `h-6 w-6` (feature cards), `h-7 w-7` (numbered "how-it-works" steps).
- **Color**: `text-foreground/80` for neutral chrome, `text-primary` for actions/eyebrows, `text-destructive` for danger, `text-muted-foreground` for meta, plus the small tinted icon chips on bento cards (`bg-primary/10 text-primary`, `bg-amber-500/10 text-amber-600`, `bg-red-500/10 text-red-600`, etc.).
- **Icon containers**: square-rounded chips, always `rounded-xl` or `rounded-2xl`, never circles. Pattern: `inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-muted/60` for neutral chips; `rounded-2xl bg-primary/10` for action chips.
- **Decorative icons** always carry `aria-hidden`.

**Recurring icons in the product** (so you can stay in vocabulary):
`QrCode`, `Scan`, `ScanLine` (the brand motif); `Bell` (alerts); `Activity` (live feed); `Package`, `Boxes` (inventory); `Users`, `PawPrint` (patients); `ListTodo`, `ClipboardCheck` (tasks); `Receipt`, `DollarSign`, `BadgePlus` (billing); `Wrench`, `AlertTriangle`, `ShieldAlert` (maintenance/issues); `MapPin`, `Home` (rooms); `WifiOff` (offline); `Building2` (clinic); `Sparkles` (today's intro); `Film` (app tour); `CheckCircle2`, `Plus`, `ArrowUpRight`, `ChevronRight` / `ChevronLeft`.

**Loading icons** — always `Loader2` with `animate-spin`. Don't substitute another spinner.

**Emoji** — not used. Anywhere. The favicon's nested-squares motif and lucide icons cover every glyph need.

**Unicode characters as icons** — only currency (`₪` for ILS, since VetTrack's primary market is Israel; `$` elsewhere). Never arrows, never bullets — those come from icons or the typographic `·` middot used in trust strips.

**Substitutions flagged**: this design system uses the live Google Fonts CDN for Plus Jakarta Sans, IBM Plex Mono, Heebo, and Rubik (identical to what the codebase loads at runtime). If you want offline-safe variants, copy the `.woff2` files into a `fonts/` folder and update `colors_and_type.css`. The brand icons and OG image were copied from `public/`; the lucide icon set is loaded via the lucide-static CDN where needed in static HTML samples.

---

## Quick reference for designers

When asked to design something new:

1. **Always pull in `colors_and_type.css`** — it sets up CSS variables matching the codebase exactly.
2. **Use the marketing UI kit** for landing pages, pricing, public-facing copy.
3. **Use the app UI kit** for in-product surfaces — dashboards, lists, alerts, command center.
4. **Default to mobile** — the app is mobile-first; desktop is a `PageShell` wrapper around the same content.
5. **Hebrew is the default locale**, but in design artifacts ship English first unless the user explicitly asks for Hebrew. Test RTL with `dir="rtl"` to verify mirroring on chrome (sidebars, chevrons, etc.).
6. **Don't invent new patterns** when an existing card / button / chip type does the job. The product's strength is operational density — variety creates noise.
