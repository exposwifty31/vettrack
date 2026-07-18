# VetTrack 1.2.0 — App Store screenshots

## What's on the store now (as uploaded this session)

- **iPhone (`APP_IPHONE_67`, 1290×2796)** — 5 fresh **Hebrew, branded** shots in `iphone-6.9/he/`:
  | # | file | screen | headline |
  |---|------|--------|----------|
  | 01 | `01-home.png` | role home / today | כל המשמרת שלך **במבט אחד** |
  | 02 | `02-code-blue.png` | Code Blue open | **קוד כחול** בלחיצה אחת |
  | 03 | `03-crash-cart.png` | daily crash-cart check | עגלת החייאה **מוכנה, כל יום** |
  | 04 | `04-equipment.png` | equipment custody | משמורת ציוד **ברורה לכולם** |
  | 05 | `05-alerts.png` | proactive alerts | התראות יזומות **לפני שמשהו נשבר** |

  These **replaced** the previous 3 iPhone shots, which were English, unbranded, and showed an older app
  version (Patients metric, old Scan/Emergency tabs) — a locale + freshness mismatch on a Hebrew-only listing.

- **iPad (`APP_IPAD_PRO_3GEN_129`, 2064×2752)** — 3 pre-existing English shots retained (owner deferred a
  Hebrew iPad refresh). Universal-app iPad requirement is still satisfied.

Folder is named `iphone-6.9` because 1290×2796 is Apple-accepted for the 6.9″ slot; it was uploaded to the
`APP_IPHONE_67` display type (which accepts 1260×2736 / 1290×2796 / 1320×2868), matching the slot the app has
used before.

## Locale

Store localization is **Hebrew only** (matches live 1.0.1). The screenshots are Hebrew (RTL), so they match.

## How they were generated (reproducible)

Captured from the **running dev-bypass app** (Hebrew renders by default), not a simulator:

1. **Capture** — headless Chromium (Playwright), viewport `430×932 @ deviceScaleFactor 3` (= 1290×2796),
   `isMobile`/`hasTouch` so `resolvePlatformTarget()` resolves to `mobile` → the real `NativeShell`.
   Routes: `/home`, `/code-blue`, `/crash-cart`, `/equipment`, `/alerts`. Dev seed QA/E2E fixture rows
   (`E2E Test Equipment`, `QA Test Monitor`, serial `11111111`, `eq1`) were hidden pre-screenshot so the
   lists show only real clinic equipment (Sweep Pump/Monitor) — how a real clinic would see it.
2. **Frame** — each raw screen composed into a 1290×2796 marketing slide via an HTML template rendered by the
   same headless Chromium (perfect Hebrew RTL/bidi + fonts, which Pillow can't do without libraqm): cohesive
   light-indigo brand background, bold RTL headline with one accent keyword, device card with soft shadow.
3. **Upload** — `asc screenshots validate` (0 errors) → delete old 3 → `asc screenshots upload
   --version-localization cc104529-… --device-type APP_IPHONE_67` → `asc screenshots list` to confirm order.

Scripts used (session scratch, not committed): capture + frame + clean-recapture .cjs under the job tmp dir.

## Re-verify

```bash
export ASC_APP_ID=6778937527
asc screenshots list --version-localization cc104529-1988-4ab8-8361-bf0dfd054aa4
```
