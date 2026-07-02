RoomReadinessCard — proposed addition (§21-D4), not yet in the published
bundle. Import from `@/components/equipment/room-readiness-card` once merged.

A summary/overview card — distinct from the real, shipped `MoveRoomSheet` and
`EquipmentRoomSweepSheet`, which are action sheets (move equipment, sweep a
room), not a readiness-at-a-glance display. Stage 6 Room Radar. Revised in
Phase 21 (review item 14, "Upgrade Room Cards") — the readiness indicator is
now a linear bar (mirrors the real `rooms-list.tsx` page's own utilization
bar) instead of a conic-gradient ring, with an auto-derived status line
("Ready for procedure" / "Partially ready" / "Needs attention", override-able
via `statusLabel`) and an optional `staffCount` for a "N devices · M staff"
line — presentational only, no real per-room staff field exists yet.

## Props

```ts
interface RoomReadinessCardProps {
  roomName: string;
  readyPercent: number;     // 0-100
  trackedCount: number;
  staffCount?: number;      // omit to hide the "· M staff" segment
  attentionCount?: number;  // omit or 0 to hide the attention chip
  statusLabel?: string;     // overrides the auto-derived status line
  className?: string;
}
```

## Usage

```jsx
<RoomReadinessCard roomName="ICU-1" readyPercent={75} trackedCount={4} staffCount={2} attentionCount={1} />
<RoomReadinessCard roomName="Recovery" readyPercent={100} trackedCount={3} staffCount={1} />
```
