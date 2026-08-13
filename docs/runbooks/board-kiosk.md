# Board Kiosk Runbook — /board wall display (TV Board Phase 1)

Operational setup for the Command Center wall display. Audience: whoever physically
installs or re-provisions a TV/kiosk in a clinic corridor. The board itself needs
zero configuration — everything below is device and browser hygiene.

## 1. Dedicated fullscreen browser profile

Run the board in its own browser profile so nothing (extensions, sync popups,
restored tabs) ever paints over the wall.

1. Create a fresh profile (Chrome: `chrome://settings` → "Add person" → e.g. `VetTrack Board`; or launch with `--user-data-dir=/opt/vettrack-board-profile`).
2. In that profile: sign in to VetTrack once with the display account, disable all extensions, disable "Continue where you left off" popups by setting the startup page to the board URL.
3. Launch flags for an unattended kiosk (Chromium-family):

   ```
   chrome --user-data-dir=/opt/vettrack-board-profile \
     --kiosk --noerrdialogs --disable-session-crashed-bubble \
     --autoplay-policy=no-user-gesture-required \
     "https://<your-host>/board?tv=1"
   ```

   `?tv=1` enables the 10-foot presentation (overscan-safe frame + TV type scale
   + D-pad focus layer). Without `--kiosk`, the app still requests fullscreen on
   the first click/keypress (the Fullscreen API needs one user gesture) — tap the
   screen once after boot.
4. Disable OS screen sleep/saver. The app holds a screen wake-lock itself
   (`KioskAwake`), but the OS-level setting is the belt to that suspender.
5. Auto-restart: add the launch command to the device's startup items so a power
   cycle returns to the board with no human. Build updates need no attention —
   the kiosk auto-reloads on a confirmed new service worker (deferred during a
   Code Blue; see `src/board/useBoardAutoReload.ts`).

## 2. TV calibration

Consumer TV "enhancements" destroy a status display: they oversharpen text,
interpolate motion, and pump contrast so state tints stop being distinguishable.
On the TV's picture menu:

- Picture mode: **off Vivid/Dynamic** — use Cinema/Filmmaker/Expert or a PC/Game
  mode (also lowers input lag).
- **Sharpness: 0** (or the mode's neutral point). Text is rendered at native
  resolution; sharpening adds halos around glyphs.
- **Motion smoothing / interpolation (TruMotion, Motionflow, etc.): OFF.**
- **Dynamic contrast / local-dimming "auto" modes: OFF** — they re-grade the
  elevation-gray palette per scene and crush the card/background separation.
- **Brightness/backlight ≤ 60%.** A corridor display runs 24/7; full backlight
  accelerates panel wear and makes the night dim step less effective.
- Set the TV input's label/mode to **PC** if available, so the TV does 4:4:4
  chroma and no overscan (the app additionally keeps a title-safe inset in
  `?tv=1`).

### State-strip tint check (required before sign-off)

The state strip's tint is applied at **15% opacity** over the board background
(`color-mix` in `src/index.css`). After calibration, verify from the far end of
the corridor (real viewing distance, real ambient light, at least once with
corridor lights at night level):

- all-clear vs attention vs alert strips are distinguishable at a glance;
- the tint survives the TV's settings (a lingering dynamic-contrast mode is the
  usual culprit when it doesn't).

Only after this check passes is the 15% opacity considered locked for that
installation. If the tints wash out, fix the TV settings first — do not raise
the opacity for one clinic's TV.

## 3. Night dim

The board dims itself (brightness cut to 35%) outside clinic hours:

- Window: **22:00–06:00, device-local clock.** There is no server-side schedule
  source in Phase 1; the constants live in `src/board/use-night-dim.ts`
  (`NIGHT_DIM_START_HOUR = 22`, `NIGHT_DIM_END_HOUR = 6`). Changing clinic hours
  means changing those constants (code change, not config).
- **Overrides (unconditional):** an active `alert` board state or an active
  Code Blue runs at full brightness at any hour. The dim is chrome, never a
  masking of a problem.
- The device clock must be correct (enable NTP) — a wrong timezone dims the
  board mid-shift.

## 4. Burn-in hygiene (summary)

Three layers, all automatic:

1. **Night dim** (above) — cuts panel drive 8 h/day.
2. **Stage rotation** — Equipment ↔ Ops view alternation moves the main-stage
   layout every ~45 s. Note: rotation pauses in single-view mode (empty Ops) and
   during alert lock, which is exactly when the other two layers carry the load.
3. **Layout drift** — the content wrapper steps 1–2 px to a new offset every
   6 minutes (24-minute cycle, discrete jumps, no continuous motion; disabled
   under `prefers-reduced-motion`). Static elements (top band, state strip)
   never park on the same pixels overnight.

OLED panels are still not recommended for a 24/7 install; prefer LCD/LED.

## 5. Corridor acceptance test

Final sign-off, performed standing where staff actually walk past:

> **A 2–3 second glance answers: "is anything wrong?" and "is anything
> waiting?"** — without stopping, without reading body text.

Check while someone toggles the states (or during normal operation):

- **All clear:** green-tinted strip + check emblem + ready/total figure readable.
- **Alert:** the strip and exception cards are unmistakably different from
  all-clear at a walking glance; the down unit's name is readable from the
  corridor midpoint.
- **Stale/offline takeover:** obviously "not live" (amber, last-known label) —
  a passer-by would not mistake old data for current.
- **Night (after 22:00):** the dimmed board is still legible up close, and an
  injected alert visibly snaps it back to full brightness.

If any of these fail, revisit §2 calibration before touching board code.
