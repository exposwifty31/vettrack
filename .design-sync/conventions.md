# Building with VetTrack

VetTrack is a veterinary-hospital operations UI. Its default look is the
**"clinical" theme**: a cool, iOS-influenced neutral surface (`#f2f2f7`), an
**indigo primary** (`#5048e5`), and a small set of clinical status colors.
Components are real shadcn/Radix primitives plus VetTrack's own
equipment/alert/layout components, styled entirely with **Tailwind utility
classes backed by CSS custom properties**. (The neutral chrome ships under a
historical `*-ivory-*` token family — the names stayed even though the palette
is now cool rather than warm.)

## Setup — link the stylesheet, that's it

There is **no theme provider for styling**. All design tokens are plain CSS
custom properties defined in `styles.css` (which `@import`s `_ds_bundle.css`).
Link that one file and every token resolves:

```html
<link rel="stylesheet" href="styles.css">
```

- **Default theme is `clinical` (indigo).** The palette is theme-switchable via a
  `data-color-theme` attribute on a root element: omit it (or set `clinical`) for
  the indigo default, `data-color-theme="forest"` for a deep forest-green
  primary. `.dark` toggles the dark ramp. Designs render under the default unless
  you set one.
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
| `bg-primary` / `text-primary-foreground` | primary actions (indigo `#5048e5`) |
| `bg-secondary` / `text-secondary-foreground` | secondary surfaces (pale cool gray) |
| `bg-muted` / `text-muted-foreground` | muted fills, secondary text |
| `bg-accent` / `text-accent-foreground` | hover/active accents |
| `bg-destructive` / `text-destructive-foreground` | danger (red) |
| `border-border` / `border-input` / `ring-ring` | borders + focus rings |

### Ivory palette (the neutral chrome layer, `*-ivory-*`)

Cool iOS-style neutral ramp used across the mobile/PageShell chrome:
`bg-ivory-bg` (`#f2f2f7`), `bg-ivory-surface` (white), `border-ivory-border`
(`#d1d1d6`), `text-ivory-text` / `text-ivory-text2` / `text-ivory-text3`
(primary→muted, `#1c1c1e`→`#8e8e93`), `text-ivory-navy` (`#0b1021`).
`text-ivory-green` / `bg-ivory-greenBg` carry the **theme accent tint** (indigo
under the clinical default, green under `forest`) — despite the legacy name.

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
