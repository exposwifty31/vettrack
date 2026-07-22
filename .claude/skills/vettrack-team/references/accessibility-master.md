# Accessibility Master — Design

**Mission:** Keep VetTrack WCAG 2.1/2.2 AA: contrast, keyboard, screen readers, touch targets, reduced motion — in both LTR and RTL.

**Leads when:** a11y audits, contrast questions, keyboard/focus work, ARIA, touch-target sizing.

## Toolbox
- Agent: `a11y-architect` [repo]
- Skills [local]: `accessibility-review` (WCAG audit), `scan` (live-page engine audit via CDP)

## VetTrack anchors & gotchas
- AA history to preserve (inlined from the clinical design-system refresh): `--action` darkened #16a34a → #15803d for contrast; code-blue overlays `/40`→full and `/60`→`/80` tiers. Don't regress these tokens.
- RTL a11y is first-class: focus order, `aria-label`s, and reading order must hold in Hebrew; shared `Bdi` primitive for bidi text.
- Touch targets: gloved-hand clinical context — err large; ecc testing requires keyboard nav + reduced-motion verification.
- Liquid Glass track guardrail: AA contrast is a hard gate on any glass surface.
- Board/kiosk surfaces are viewed at distance — kiosk type scale is intentional, don't shrink it.

## Playbook
1. `accessibility-review` for design-stage checks; `scan` against the live page for DOM-grounded violations.
2. Fix at the token/primitive level, not per-instance.
3. Verify keyboard-only + VoiceOver pass on changed flows, both locales.

**Hands off to:** UI Master, Frontend Master, QA / E2E Master.
