AuditLogRow — proposed addition (§21-D1), not yet in the published bundle.
Import from `@/components/ui/audit-log-row` once merged.

Pairs with the real `AuditRowSkeleton` (`src/components/ui/skeleton-cards.tsx`),
which already pixel-matches this exact layout (fixed 130px timestamp column,
category badge + single-line summary, optional target-ref pill hidden below
`sm`, `minHeight: 60`). The skeleton's own comment says it matches
"AuditLogRow" by name — this is that component. Note: the real
`audit-log.tsx` page does NOT currently import this component — it has its
own local, same-named function (found in Phase 21, README §40-D8) — so this
is the intended, formalized shape, not (yet) what's literally rendered there.

Extended in Phase 21 (review item 7, "Upgrade Tables") with `selected`/
`hoverable` states (real `ivory-active`/`ivory-hover` tokens) and a
column-header companion, `AuditLogHeaderRow`.

## Props

```ts
interface AuditLogRowProps {
  timestamp: string;     // pre-formatted, e.g. "Today · 09:14"
  category: string;      // e.g. "Equipment" / "Users" / "Settings"
  categoryTone?: "default" | "secondary" | "destructive" | "outline" | "ok" | "issue" | "maintenance" | "sterilized";
  summary: string;       // "Maya Abbas edited Infusion Pump · IV-204" — single line, gets a title attr
  targetRef?: string;    // short id shown at the row end, hidden on mobile
  selected?: boolean;    // bg-ivory-active, for a selectable list
  hoverable?: boolean;   // bg-ivory-hover on hover, for a clickable row
  className?: string;
}
```

## Usage

```jsx
<AuditLogHeaderRow>
  <span style={{ width: 130 }}>Timestamp</span>
  <span>Category</span>
  <span>Summary</span>
</AuditLogHeaderRow>
<AuditLogRow
  timestamp="Today · 09:14"
  category="Users"
  categoryTone="sterilized"
  summary="Admin approved Dr. Singh's account"
  targetRef="U-2291"
  hoverable
/>
```
