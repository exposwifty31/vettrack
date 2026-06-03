# App UI Kit

Recreation of the VetTrack PWA's mobile-first dashboard and equipment list. Source: `src/pages/home.tsx` + `src/pages/equipment-list.tsx` from `dboy3156/VetTrack`.

**Components**
- `MobileTopbar.jsx` — sticky blurred topbar: menu, mark + product name, bell (with badge), avatar.
- `BottomNav.jsx` — 5-slot bottom nav with a raised primary Scan FAB.
- `Cards.jsx` — shared building blocks: `Card`, `KpiCard`, `StatusPill` (the codebase's `StatusBadge`).
- `HomeScreen.jsx` — greeting card · 4 KPI grid · 4 quick actions · live activity feed · inventory alerts.
- `EquipmentScreen.jsx` — header w/ Scan + Add · search · status chip rail · room chip rail · equipment list w/ animal pawprint indicator.

**Composition** — `index.html` mounts two phones side by side (LTR + RTL) with a Home / Equipment toggle on top.

**Notes**
- The Scan/QR scanner sheet and Shift Summary sheet from the real codebase are NOT included; the buttons are visually present but inert.
- Hebrew strings are real translations of the equivalent app copy (matches the i18n labels from `src/lib/i18n.ts`).
