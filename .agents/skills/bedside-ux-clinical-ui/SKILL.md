---
name: bedside-ux-clinical-ui
description: Audits React bedside UI for speed, clarity, minimal navigation, and tablet-friendly targets (ward board, Code Blue, equipment flows). Use when reviewing display, emergency takeover, RTL layouts, or clinical Tailwind/Radix components.
---

# Bedside UX & clinical UI

## Quick start

1. Read [`docs/architecture/offline-realtime-invariants.md`](../../docs/architecture/offline-realtime-invariants.md) for ward/Code Blue transport rules.
2. Walk the **critical path in under three taps** to the primary action.
3. Checklist: [REFERENCE.md](REFERENCE.md).

## Workflows

### A — Ward / floor display (`/equipment/board`)

- Glanceability on tablet breakpoints.
- Code Blue state visible via SSE snapshot — no polling fallback.

### B — Code Blue / takeover

- Full-screen overlay; plain-language errors; online-only mutations.

### C — Tablet ergonomics

- Minimum **44×44 CSS px** targets; no hover-only affordances.

### D — i18n & RTL

- Copy in `locales/*.json` only; logical spacing properties for RTL.

## Reference implementation

- `src/pages/display.tsx` — ward board
- `src/pages/code-blue.tsx`, `src/pages/code-blue-display.tsx` — emergency surfaces
