# ConfidenceIndicator

ConfidenceIndicator — proposed addition (§20-D2), not yet in the published
bundle. Import from `@/components/equipment/confidence-indicator` once merged.

Sits alongside `EquipmentTruthCard`/`DeployabilityBadge` on the equipment
detail view — DeployabilityBadge/EquipmentTruthCard answer "what state is
this equipment in"; ConfidenceIndicator answers "how sure are we about the
custody/location inference." Never render without a `reasoning` string —
per the Equipment Hero PRD, uncertainty must always cite evidence, never a
bare score.

## Props

```ts
interface ConfidenceIndicatorProps {
  confidence: "high" | "medium" | "low" | "unknown";
  reasoning: string; // e.g. "Checked out by Dr. Lee · 12 min ago"
  compact?: boolean; // badge-only for list rows vs. full row for hero cards
  className?: string;
}
```

## Usage

```jsx
<ConfidenceIndicator
  confidence="high"
  reasoning="Checked out by Dr. Lee · 12 min ago"
/>

<ConfidenceIndicator confidence="low" reasoning="Last seen via passive RFID · 2h ago" compact />
```
