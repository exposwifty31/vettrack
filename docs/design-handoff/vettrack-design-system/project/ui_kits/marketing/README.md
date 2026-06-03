# Marketing UI Kit

Recreation of the VetTrack public landing page (`src/pages/landing.tsx` + `src/components/marketing-layout.tsx`).

**Components**
- `Header.jsx` — sticky blurred header with the QrCode mark lockup and a primary sign-in CTA.
- `Hero.jsx` — H1 + dual CTA + 3-line trust strip + walkthrough video panel (placeholder gradient).
- `Stats.jsx` — `QuickStrip` chip rail and the 3-stat outcomes row.
- `Bento.jsx` — 6-column bento grid of feature tiles (large + small variants).
- `Sections.jsx` — `HowSteps` (3-step numbered row), `Quote` (5-star testimonial card), `FinalCta` (green-filled radial CTA), `Footer`.

**Composition** — see `index.html`. The page renders the components in landing-page order.

**Things intentionally not copied**
- Clerk sign-in modal — replaced with a plain button.
- Beforeinstallprompt PWA banner — would only render in browsers that fire that event.
- Helmet `<head>` SEO meta — see `src/pages/landing.tsx` for the real meta block.

**Inputs**
- Brand mark: 14px-radius square chip with `QrCode` icon at `--primary` background. Same lockup is used in `Footer` at smaller scale (36×36, radius 12).
- All icons are inlined via `_shared/Icons.jsx` (lucide paths, stroke-2).
