# VetTrack — Motion, Haptics & Sound

The feel spec for the VetTrack PWA. Motion is **calm at rest, responsive on touch, celebratory only on earned moments.** The product is used one-handed during medical shifts — feedback must be instant and never block the next action.

> Implements the principle from the design system: **enter once, then rest.** One entrance choreography per screen load; one live indicator max; no infinite decorative loops on working surfaces.

---

## 1. Motion

### Timing tokens
| Token | Value | Use |
|---|---|---|
| `--motion-instant` | 120ms | State changes (hover, toggle, chip select) |
| `--motion-quick` | 200ms | Button press, sheet backdrop, color shifts |
| `--motion-enter` | 600–620ms | Per-screen entrance (`proRise`), staggered 70ms/child |
| `--motion-celebrate` | 360–700ms | Earned moments (scan check, ring draw, first-scan) |
| `--motion-pill` | 320ms | Bottom-nav active-tab pill travel |

### Easing
- **Entrances / content:** `cubic-bezier(0.2, 0.8, 0.2, 1)` — soft decelerate, no overshoot.
- **Rewards / pills:** `cubic-bezier(0.34, 1.56, 0.64, 1)` — slight overshoot. Reserved for *earned* feedback (ring fill, nav pill), never for routine UI.
- **Exits:** `ease-in`, 160ms — quick and unceremonious.

### Patterns
- **Screen entrance** — `proRise`: 10px translateY + opacity, 620ms, children staggered (`:nth-child` delays 0 / 70 / 140 / 210 / 280ms). Fires once on mount. **Disabled** under `prefers-reduced-motion` and in print/PDF (visible end-state is the base style).
- **Progress ring draw** — `stroke-dasharray` transition, 1100ms, overshoot easing. Animates *to* the value on mount.
- **Counter count-up** — `ProCount`, ease-out-cubic, 850–1000ms. Used for shift stats, scan totals.
- **Live indicator** — one soft pulse per screen, 2.2s ease-out infinite, on the single freshest item only. (Equipment "Just used" dot; Alerts "worst-first" ring.)
- **Press** — `active:scale(0.97)` buttons / `scale(0.99)` cards, `motion-safe` only.

### Hard rules
- **One** entrance choreography per screen. Never re-animate on tab return.
- **One** infinite/looping indicator per screen, max.
- Never animate layout-shifting properties on the working surface (no height/margin animation that pushes content).
- All decorative motion gated behind `@media (prefers-reduced-motion: no-preference)`.

---

## 2. Haptics

Web Vibration API (`navigator.vibrate`) on Android PWA; iOS Safari ignores it, so **haptics are an enhancement, never the only feedback** — always pair with a visual change.

```js
const haptics = {
  tap:      () => navigator.vibrate?.(10),          // routine confirm (checkout, toggle)
  success:  () => navigator.vibrate?.([0, 30]),     // scan logged, task complete
  warning:  () => navigator.vibrate?.([0, 20, 40, 20]), // overdue / validation block
  celebrate:() => navigator.vibrate?.([0, 18, 40, 18, 40, 28]), // first scan, streak, milestone
};
```

| Trigger | Pattern | Paired visual |
|---|---|---|
| Scan detected | `success` | Sub-300ms green check + counter bump |
| Task / check complete | `tap` | Row check + status flip |
| First scan of day | `celebrate` | Full celebration overlay |
| Streak / milestone earned | `celebrate` | Recap badge pop |
| Dose hard-stop / overdue | `warning` | Red triangle + blocking dialog |
| Bulk action confirmed | `tap` | Toast |

Honour a user setting (`settings.haptics`) and skip all vibration when off. Never fire haptics on passive events (scroll, page load).

---

## 3. Sound

**Off by default.** Veterinary ICUs are noise-sensitive and often already alarm-saturated. Sound is opt-in (`settings.sound`) and only ever attached to a *discrete, earned* moment — never ambient, never on navigation.

| Cue | Character | When |
|---|---|---|
| Scan success | Short, soft, ~80ms rising "tick" | Equipment scanned (if sound on) |
| Milestone | Warm two-note resolve, ~300ms | Streak / weekly recap unlocked |
| Critical alert | Distinct, non-alarm-clashing, ~400ms | New urgent alert *only when app foregrounded* |

Rules:
- Never play sound while a system alarm could be active (defer to OS-level Code Blue tones).
- All cues ≤ 400ms; no loops.
- Respect device silent switch (iOS) — sounds route through the ambient channel, not playback.
- Always redundant with a visual + (where available) haptic. Sound is the third channel, never the first.

---

## 4. The "earned moment" budget

Celebration is the magnetic hook — but rationed so it stays meaningful:

1. **First scan of the day** — the big one. Full overlay, ring draw + check, streak chip, `celebrate` haptic. Once per day.
2. **Every scan after** — micro only. Sub-300ms check, counter bump, `success` haptic. No overlay.
3. **Task / check complete** — row-level check animation, `tap` haptic.
4. **Streak / weekly recap** — lives in the **Recap** room. Badge pop on entry, shareable shift card. Never interrupts a working screen.
5. **Monthly recap** — a scheduled, anticipated drop (PDF + shareable card).

Everything else stays calm. If every action celebrates, none of them mean anything.
