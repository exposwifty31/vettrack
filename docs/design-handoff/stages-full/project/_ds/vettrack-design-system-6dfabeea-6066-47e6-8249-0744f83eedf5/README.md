# Building with VetTrack

VetTrack is a veterinary-hospital operations UI. Its look is the **"Ivory" design
system**: a warm off-white background, forest-green primary, and a small set of
clinical status colors. Components are real shadcn/Radix primitives plus
VetTrack's own equipment/alert/layout components, styled entirely with **Tailwind
utility classes backed by CSS custom properties**.

## Setup — link the stylesheet, that's it

There is **no theme provider for styling**. All design tokens are plain CSS
custom properties defined in `styles.css` (which `@import`s `_ds_bundle.css`).
Link that one file and every token resolves:

```html
<link rel="stylesheet" href="styles.css">
```

- **The app is right-to-left by default.** Hebrew is the primary locale; set
  `dir="rtl"` on a wrapping element for authentic layout (the components use
  logical/RTL-aware spacing). `dir="ltr"` is fine for English screens.
- **Primitives (Button, Card, Badge, Input, Label, Checkbox, Textarea, Select,
  Dialog, Sheet, Tabs, Skeleton, EmptyState, StatusBadge…) render standalone** —
  no context needed.
- **Data-driven components need app context.** Anything that loads data
  (`AlertsDropdown`, `OperationalMetricsDashboard`, `WaitlistPanel`,
  `AppShell`, `Topbar`, and most `equipment/*` panels) expects a TanStack
  **QueryClientProvider** and, for navigation, a **wouter `Router`**. When
  designing a screen, prefer the presentational primitives and pass data as
  props; reach for the data components only inside a provider shell.

## The styling idiom — Tailwind utilities over token-backed colors

Style with Tailwind classes. **Do not invent hex colors** — use these
token-backed families (all verified present in the shipped stylesheet). Every
component also accepts `className` (merged via `cn()` / tailwind-merge), so you
override and extend by passing utilities.

### Semantic surface + text (the default vocabulary)

| Class family | Use |
|---|---|
| `bg-background` / `text-foreground` | page surface + body text |
| `bg-card` / `text-card-foreground` | cards, raised panels (white) |
| `bg-popover` / `text-popover-foreground` | menus, popovers |
| `bg-primary` / `text-primary-foreground` | primary actions (forest green) |
| `bg-secondary` / `text-secondary-foreground` | secondary surfaces (pale green) |
| `bg-muted` / `text-muted-foreground` | muted fills, secondary text |
| `bg-accent` / `text-accent-foreground` | hover/active accents |
| `bg-destructive` / `text-destructive-foreground` | danger (red) |
| `border-border` / `border-input` / `ring-ring` | borders + focus rings |

### Ivory palette (the brand layer, `*-ivory-*`)

Warm-neutral brand surface used across the mobile/PageShell chrome:
`bg-ivory-bg` (#f3f1eb), `bg-ivory-surface` (white), `border-ivory-border`,
`text-ivory-text` / `text-ivory-text2` / `text-ivory-text3` (primary→muted),
`text-ivory-navy`, `text-ivory-green`, `bg-ivory-greenBg` (selected/success
tint).

### Clinical status colors (`*-status-*`)

`status-ok` (green), `status-issue` (red), `status-maintenance` (amber),
`status-sterilized` (blue) — available as `bg-status-*`, `text-status-*`,
`border-status-*`. Prefer the **`StatusBadge`** / **`Badge`** components (their
`variant` props — e.g. `ok`/`issue`/`maintenance`/`sterilized` — encode these
semantics) over hand-coloring.

### Radius, shadow, type, motion

- Radius: `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-2xl`,
  plus `rounded-full` for pills.
- Shadow: `shadow-card` (resting cards), `shadow-card-hover` (hover lift),
  `shadow-surface` (floating surfaces).
- Type: `font-sans` (Plus Jakarta Sans / Heebo — the default UI face),
  `font-mono` (IBM Plex Mono), `font-num` (DM Mono — tabular numerals for
  stats/counts).
- Motion: `animate-fade-in` for entrances. (Keep motion subtle — this is an
  operations tool, not a marketing site.)

> **Fonts are runtime/host-served** (Plus Jakarta Sans, Heebo, Noto Sans Hebrew,
> Rubik, DM Mono, IBM Plex Mono). They are not bundled; load them from your host
> page (e.g. Google Fonts) or accept the system fallback.

## Where the truth lives

- `styles.css` and its `@import` closure (incl. `_ds_bundle.css`) — every token
  and utility class actually shipped. Read it before introducing a new class.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component props + usage.
- `components/<group>/<Name>/<Name>.d.ts` — the typed prop contract (real
  unions, e.g. `Button` `variant`/`size`, `DeployabilityBadge` state enums).

## One idiomatic build snippet

A status card composed from real components plus the DS's own utility classes:

```jsx
const { Card, CardHeader, CardTitle, CardContent, Badge, Button } = window.VetTrack;

function VentilatorCard() {
  return (
    <Card className="max-w-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Ventilator · ICU-2</CardTitle>
        <Badge variant="ok">Ready</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Last serviced 3 days ago · docked in Recovery
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm">Check out</Button>
          <Button size="sm" variant="outline">Details</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

# VetTrack (vettrack@1.1.2)

This design system is the published vettrack React library, bundled as a single
browser global. All 110 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.VetTrack`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).
- `guidelines/` — the design system's own usage guidance (2 doc(s), see `guidelines/index.md`). Read these before composing larger layouts.

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.VetTrack.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { AlertCard } = window.VetTrack;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<AlertCard />);
```

## Tokens

190 CSS custom properties from vettrack. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (24): `--tw-border-spacing-x`, `--tw-border-spacing-y`, `--tw-ring-offset-color`, …
- **spacing** (2): `--tw-ring-inset`, `--tw-space-y-reverse`
- **typography** (1): `--font-num`
- **radius** (6): `--radius`, `--radius-sm`, `--radius-md`, …
- **shadow** (7): `--tw-ring-offset-shadow`, `--tw-ring-shadow`, `--tw-shadow`, …
- **other** (150): `--tw-translate-x`, `--tw-translate-y`, `--tw-rotate`, …

## Components

### alerts
- `AlertCard`
- `AlertsProView`

### general
- `AlertDialog`
- `AlertDialogAction`
- `AlertDialogCancel`
- `AlertDialogContent`
- `AlertDialogDescription`
- `AlertDialogFooter`
- `AlertDialogHeader`
- `AlertDialogOverlay`
- `AlertDialogPortal`
- `AlertDialogTitle`
- `AlertDialogTrigger`
- `AlertsDropdown`
- `AppErrorBoundary`
- `AuditRowSkeleton`
- `Badge`
- `Button`
- `Card`
- `CardContent`
- `CardDescription`
- `CardFooter`
- `CardHeader`
- `CardTitle`
- `Checkbox`
- `CrashCartAdminSheet`
- `CsvImportDialog`
- `Dialog`
- `DialogClose`
- `DialogContent`
- `DialogDescription`
- `DialogFooter`
- `DialogHeader`
- `DialogTitle`
- `DialogTrigger`
- `EmptyState`
- `ErrorCard`
- `FirstScanCelebration`
- `HelpTooltip`
- `Input`
- `Label`
- `LoadingSection`
- `MoveRoomSheet`
- `OnboardingWalkthrough`
- `PageErrorBoundary`
- `ReportIssueDialog`
- `ReturnPlugDialog`
- `RouteFallback`
- `SectionList`
- `Select`
- `SelectContent`
- `SelectGroup`
- `SelectItem`
- `SelectLabel`
- `SelectSeparator`
- `SelectTrigger`
- `SelectValue`
- `SettingsSectionHeader`
- `SettingsSelect`
- `SettingsToggle`
- `Sheet`
- `SheetClose`
- `SheetContent`
- `SheetDescription`
- `SheetFooter`
- `SheetHeader`
- `SheetTitle`
- `SheetTrigger`
- `ShiftSummarySheet`
- `Skeleton`
- `SkeletonAlertCard`
- `SkeletonEquipmentCard`
- `StatusBadge`
- `SwUpdateBanner`
- `SyncQueueSheet`
- `SyncStatusBanner`
- `Tabs`
- `TabsContent`
- `TabsList`
- `TabsTrigger`
- `Textarea`
- `UpdateBanner`
- `VirtualizedEquipmentList`

### layout
- `AppShell`
- `Breadcrumb`
- `IconSidebar`
- `PageShell`
- `Sidebar`
- `SidebarDivider`
- `Topbar`

### equipment
- `AssetCopilotPanel`
- `ConditionChecklist`
- `DeployabilityBadge`
- `DockReturnFlow`
- `EquipmentConfirmInRoomSheet`
- `EquipmentDetailActivityTab`
- `EquipmentDetailStatusStrip`
- `EquipmentDetailToolsSheet`
- `EquipmentHeroCoverageStrip`
- `EquipmentRoomSweepSheet`
- `EquipmentStatStrip`
- `EquipmentTriageList`
- `EquipmentTruthCard`
- `OperationalMetricsDashboard`
- `ReservationBanner`
- `StagingQueuePanel`
- `WaitlistPanel`

### skeletons
- `EquipmentDetailSkeleton`
- `EquipmentListSkeleton`

### home
- `ShiftProgressHero`
