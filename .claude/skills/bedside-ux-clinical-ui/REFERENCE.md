# Bedside UI reference — visibility & Tailwind habits

## Clinical visibility (non-negotiable)

- **Contrast**: text vs background minimum ~4.5:1 for body; critical numerals (doses, vitals) prefer higher. Avoid low-contrast gray on colored strips for primary facts.
- **Size**: clinical numerals at least `text-base` on tablets; avoid `text-xs` for doses unless paired with an obvious expansion control.
- **States**: loading vs empty vs error must be visually distinct—never silent blank panels during emergencies.

## Tailwind patterns (lint mentally or in review)

| Prefer | Avoid at bedside |
|--------|-------------------|
| `gap-*` grid/flex spacing | Cramped `space-y-1` stacks for primary actions |
| Semantic surfaces (`bg-card`, `border-border`) | Random hex fills unrelated to theme |
| `focus-visible:ring-2` on interactive elements | Keyboard traps without focus return |
| `motion-reduce:` variants for heavy animation | Long `duration-700` transitions on state changes |

## Radix / shadcn alignment

- Keep dialog titles and descriptions wired for screen readers; destructive actions use `AlertDialog`.
- Toast vs inline error: **blocking** clinical mistakes need inline proximity; toasts for background confirmation only.

## Code Blue-specific

- One dominant action color per phase (e.g. acknowledge vs escalate)—do not reuse the same accent for unrelated controls.
- Persist minimal patient identity in the overlay chrome if the underlying list scrolls.

## Related paths

- Invariants: `docs/architecture/offline-realtime-invariants.md`
- Example large clinical surface: `src/pages/display.tsx`
- Shared primitives: `src/components/ui/`
