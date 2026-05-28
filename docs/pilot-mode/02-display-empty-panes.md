# 02 — Ward Display empty panes (P2.1 / F1)

## Context

**F1:** Equipment-only pilots use `/display` as the department equipment radar. With no hospitalizations, tasks, or crash-cart check data, the UI showed alarming empty clinical chrome ("⚠ עגלה לא נבדקה היום", "0 מאושפזים", empty patient grid).

## Change

| File | Summary |
|------|---------|
| `src/pages/display.tsx` | `getDisplayPaneVisibility()` drives data-driven rendering: crash-cart pill only when `crashCartStatus` is non-null; hospitalization count, `PatientGrid`, and `UpcomingTasksPane` only when respective arrays have rows. `EquipmentPane` always renders. |
| `tests/display-empty-panes.test.ts` | F1-prefixed vitest for visibility helper. |

`/api/display/snapshot` unchanged (empty arrays still returned).

## Why this approach

- **Data-driven**, not `isPilotMode` — improves Ward Display for any clinic with sparse clinical data.  
- **Rejected:** Server-side snapshot pruning — risks Phase 9 / display contract tests.  
- **Rejected:** Pilot-only CSS hide — would still fetch/render empty grids.

## Verification

```bash
npx tsc --noEmit
pnpm test -- display-empty-panes
pnpm test
pnpm build
```

Manual: open `/display` with snapshot lacking hospitalizations/tasks/null crash cart → only equipment column + shift bar; no crash-cart warning, no "0 מאושפזים", no patient grid.

## Rollback

`git revert <sha>` — prior always-on panes return. No DB or env impact.

## Refs

- Plan: P2.1 — Conditional render on `/display` (F1)  
- PR: (filled after merge)  
- Deployed SHA: (filled after merge)
