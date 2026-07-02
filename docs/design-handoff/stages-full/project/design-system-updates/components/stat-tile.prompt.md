StatTile — proposed addition (§20-D5), not yet in the published bundle.
Import from `@/components/ui/stat-tile` once merged.

Generic KPI tile: icon+label leads, then a large value, then an optional
trend line. Formalizes markup that was hand-rolled repeatedly across the
handoff (Management Dashboard KPIs, Item Detail on-hand figure, Shift
Handover stats row). Revised in Phase 21 (review item 5, "Upgrade Stat
Cards") — was value-first with the trend crammed top-right as a bare
delta; now `min-h-[120px]`, icon+label on top, and `trend` reads as a full
sentence ("+12.4% this month") rather than "+12%". Prop names are
unchanged from §20-D5 — only the layout and recommended trend format
changed, so no import updates needed once merged.

## Props

```ts
interface StatTileProps {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
  trend?: string;              // full sentence, e.g. "+12.4% this month"
  trendTone?: "ok" | "issue" | "neutral";
  className?: string;
}
```

## Usage

```jsx
<StatTile
  icon={<TrendingUpIcon className="h-4 w-4" />}
  value="94%"
  label="Equipment uptime"
  trend="+2% this week"
  trendTone="ok"
/>
```
