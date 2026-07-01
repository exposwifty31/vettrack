Podium / RankedList — proposed addition (§21-D3), not yet in the published
bundle. Import from `@/components/general/leaderboard` once merged.
Genuinely new — no real equivalent (Stage 7 Shift Leaderboard).

`Podium` renders exactly 3 entries (any input order) visually as 2nd/1st/3rd,
sized and colored by rank via `PODIUM_RANK_VAR`. `RankedList` renders 4th
place onward as a flat list. Used together on one screen.

## Props

```ts
interface PodiumEntry { rank: 1 | 2 | 3; name: string; points: number; initials: string; }
interface PodiumProps { entries: PodiumEntry[]; className?: string; }

interface RankedRow { rank: number; name: string; initials: string; meta: string; points: number; }
interface RankedListProps { rows: RankedRow[]; className?: string; }
```

## Usage

```jsx
<Podium entries={[
  { rank: 1, name: "Maya Abbas", points: 341, initials: "MA" },
  { rank: 2, name: "Tech Ruiz", points: 284, initials: "TR" },
  { rank: 3, name: "Dana K.", points: 251, initials: "DK" },
]} />

<RankedList rows={[
  { rank: 4, name: "Dr. Singh", initials: "DS", meta: "41 scans", points: 228 },
]} />
```
