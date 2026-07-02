RoleBadge — proposed addition (§20-D5), not yet in the published bundle.
Import from `@/components/ui/role-badge` once merged; re-exports through
`window.VetTrack.RoleBadge` after the next design-sync build.

Thin wrapper over `StatusBadge` — reuses the existing status color palette via
`roleToStatusKind()` rather than introducing new colors.

## Props

```ts
interface RoleBadgeProps {
  role: "admin" | "vet" | "senior_technician" | "technician" | "student";
  label?: string; // rare override; defaults to t.roles[role]
  className?: string;
}
```

## Usage

```jsx
<RoleBadge role="senior_technician" />
<RoleBadge role="admin" />
```
