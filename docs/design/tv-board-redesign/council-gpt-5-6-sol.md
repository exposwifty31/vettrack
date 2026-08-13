# GPT-5.6 Sol council report: redesigning VetTrack’s critical-equipment TV board

## Executive diagnosis

The board is visually calm, but currently calm because it is *empty*, not because it communicates system state well. At normal wall-TV distance, nearly every supporting label is too small and low-contrast; the middle is mostly unused black space; the right rail fragments equipment configuration, staff sign-in, electricity, and dock status into equally weak cards; and the most prominent non-header element is an administrative banner (“17 proposals awaiting approval”) that does not appear to answer the clinical question, “Is anything unavailable, and what must we do now?” The tiny close control and the visible browser chrome also imply a desktop web page projected onto a TV, rather than a purpose-built ambient display.

The redesign should be a **state-weighted operational display**, not a dense dashboard. In normal operation, it should answer three questions in one glance: **overall state, available/total equipment, and whether the data can be trusted**. In an exception, the same stable layout should transform emphasis—not rearrange itself—to answer: **what failed, where it is, how long it has been unavailable, and who owns the response**. Research in control-room settings supports linking alarms to the relevant visual area and integrating complementary views rather than making operators mentally associate disconnected displays ([Frontiers/PMC control-room study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8995508/)).

A key design principle is **“calm mode, incident mode.”** Green should not flood the screen when everything is fine; normality is the neutral baseline with one restrained confirmation. Color, space, and motion are then conserved for exceptions. This makes the result look more professional while also improving detection: the rare event changes the visual field materially, rather than competing with permanent bright cards, borders, and labels.

---

## 1. Typography for ten-foot viewing

Treat the TV as a different medium, not a large desktop monitor. Android’s TV guidance says television interfaces are viewed from a distance and should use larger typography, broad/legible forms, large counters, and non-decorative faces; it explicitly warns that thin strokes are not instantly recognizable at a glance ([Android TV typography](https://developer.android.com/design/ui/tv/guides/styles/typography)). Apple’s current tvOS scale is a useful calibration point: 29 pt medium body, 38 pt headline, and 48–76 pt title styles, with a 23 pt minimum—not because this board is a tvOS app, but because those dimensions reflect room-distance viewing ([Apple typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

For a 1920×1080 design canvas, use a Hebrew-capable sans serif such as **Noto Sans Hebrew** or **Heebo**, but only after testing its actual strokes on the clinic TV. Specify four roles: **72–88 px / 700** for the main status or critical count; **40–48 px / 650** for section and alert titles; **30–34 px / 550–650** for equipment names, owners, and the clock; and **24–28 px / 500** as an absolute floor for secondary labels. Use line-height around 1.15 for display text and 1.25–1.35 for two-line labels. Never use light weights; Apple likewise advises Regular through Bold and cautions against Ultralight, Thin, and Light weights ([Apple typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

Numbers deserve special treatment. Enable `font-variant-numeric: tabular-nums lining-nums` for counts, elapsed times, and `10:18`, so changing digits do not jitter. Make the operational count a semantic phrase—`12 מתוך 12 זמינים`—rather than isolated zeros, and never let the type hierarchy depend on subtle gray-on-gray differences. Test the rendered page at the *actual mounting distance*, under daytime glare and night lighting, on the least capable supported panel; browser zoom screenshots on a laptop do not validate ten-foot readability.

Finally, reduce text quantity before shrinking type. The current list of every staff member followed by repeated `לא סומן` is a desktop-style audit list. On the TV, compress it to `אחראי משמרת: לא סומן` or, if assignment is not operationally required, remove it from the wall board entirely. A wall display should show names only when they create an action path—for example, `בטיפול: ד״ר לוי` on an unavailable pump.

---

## 2. Color, contrast, and TV-panel behavior

Keep the dark theme, but replace pure black plus barely differentiated charcoal with a controlled luminance ladder. A practical palette is: canvas `#0B1016`, surfaces `#131A22`, raised/alert surface `#1B2530`, primary text `#F4F7FA`, secondary text `#AAB6C3`, information cyan `#58C7D9`, warning amber `#FFB547`, critical coral-red `#FF6B6B`, and success mint `#66D19E`. Using the WCAG luminance formula, these text colors range from 6.31:1 to 16.3:1 on the proposed surface; WCAG requires at least 4.5:1 for normal text and 3:1 for large text, while also warning that thin anti-aliased type can look fainter than its nominal CSS color ([W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).

Do not make every “healthy” object green. Render available items in neutral white/gray and reserve a small mint icon plus the explicit word `זמין` for the summary. Warnings use amber plus a triangle and text; critical failures use coral-red plus an octagon or bold left/right edge marker and the word `קריטי`. This prevents the red/green ambiguity problem and ensures severity remains interpretable in grayscale, by viewers with color-vision differences, or on a badly calibrated TV. Avoid red text on black for small labels; W3C specifically notes a caveat for long-wavelength red against dark backgrounds for people with protanopia ([W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).

Use surfaces to group, not to decorate. Remove most 1-pixel borders, dashed circles, and pill outlines—their strokes disappear at distance and the proliferation makes all regions look equally important. Prefer 16–24 px corner radii, 32–40 px internal padding, and a 6–8 px severity rail on exception cards. The screen should have one neutral background, one card elevation, and one exception elevation. No gradients, glow, glassmorphism, or shadows are needed; on TV panels they introduce bloom and reduce edge clarity.

Calibrate for the physical display. Disable “Vivid” picture mode, excessive sharpening, motion smoothing, and dynamic contrast; choose a standard/sRGB-like mode and set brightness for the room rather than maximum output. If the clinic uses OLED, treat this persistent UI as a retention risk: Sony warns that long-displayed static application content, clocks, logos, bright colors, and tickers can cause retention, and recommends avoiding persistent bright static elements ([Sony OLED support](https://www.sony.co.uk/electronics/support/articles/00173479)). Use the panel’s pixel-shift/logo-dimming protections, dim the board out of hours, and make only imperceptible positional shifts during quiet periods—never movement that compromises reading.

---

## 3. Layout and information hierarchy

Design on a **12-column RTL grid inside a TV-safe frame**. Apple recommends keeping primary tvOS content 60 points from the top/bottom and 80 points from the sides because edge content is hard to see and older TVs may overscan it ([Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout)). For a web kiosk at 1080p, adopt the simpler conservative rule: keep all meaningful content within the inner 90% (about 96 px at each side and 54 px top/bottom), while allowing only the background to bleed to the bezel.

The top band should be 11–13% of screen height and contain, from the leading/right side, `ציוד קריטי · המחלקה`, then the compact operational summary `12/12 זמינים`; the time sits at the trailing/left side, with a small freshness line beneath it. The browser tabs, URL bar, cursor, close button, and any navigation must disappear in kiosk/fullscreen mode. Because the TV has no mouse or keyboard, every visible control is misleading visual noise; settings and approvals belong on a separate authenticated workstation/tablet.

Below, give 65–70% of width to the **exception/availability zone** and 30–35% to the **context rail**. In normal mode, the large zone shows a compact success panel in its upper portion—check icon, `כל הציוד הקריטי זמין`, `12 מתוך 12`—followed by either a small category inventory (`הנשמה 4/4 · ניטור 5/5 · שאיבה 3/3`) or a recent-event line. Do not center a tiny checkmark in a huge void. Empty space should frame a strong message, not reveal that the layout has no content model.

The context rail should contain only three operational modules: **power** (`חשמל: 2 מחוברות · 0 התראות`), **docks** (`2/2 פעילות`), and **shift owner** (`לא סומן` or the owner name). Replace the current repeated counters with noun-first, human-readable phrases. Move `17 הצעות ממתינות לאישור` to a subtle utility chip only if someone viewing the TV can act on it promptly; otherwise remove it from this board. It is an administrative queue, not an equipment-health signal, and its current prominence weakens the clinical hierarchy.

When an incident occurs, preserve the same grid and replace the normal-mode success block with up to three ranked exception cards. Each card should read in a single scan: `מכונת הנשמה 2` / `לא זמינה` / `טיפול נמרץ` / `12 דק׳` / `בטיפול: נועה`. Sort first by clinical severity, then by elapsed time. If there are more than three, show `+4 תקלות נוספות` rather than shrinking everything; the wall board is the overview, not the incident-management console.

---

## 4. Empty states that build trust

The current screen presents two different empty-state messages: “all critical equipment is available” in the center and “no critical equipment is defined” in the rail. Those states can be mutually incompatible. A professional system must distinguish at least four conditions: **healthy**, **nothing configured**, **no data**, and **loading**. Never use a green check for anything except a verified healthy state.

For **healthy**, say `כל הציוד הקריטי זמין` and support it with evidence: `12 מתוך 12 · נבדק כעת`. For **nothing configured**, use a neutral outlined equipment icon and `לא הוגדר ציוד קריטי`, plus an off-screen action hint such as `יש להגדיר במערכת הניהול`; do not imply clinical safety. For **no data/offline**, use amber or red according to duration, `אין נתונים עדכניים`, the last successful data time, and an explicit instruction or owner. For **loading**, retain the prior known state with `מתעדכן…` rather than blanking the board or showing zeros.

Zero is a valid value only when the metric is understood. Replace `0` bars named “waiting list” and “preparation” with complete statements: `אין ציוד בהמתנה` and `אין ציוד בהיערכות`. If these stages are not important when zero, collapse them into one secondary line. Do not show an empty progress track at zero: at distance it resembles an inactive or failed component and consumes a full row without adding evidence.

The deeper rule is **state provenance**. Every positive claim should reveal what it is based on—configured inventory count, latest successful heartbeat, and freshness threshold. A blank database must not be indistinguishable from a perfectly healthy clinic. This is more important than adding visual polish: a modern-looking green check that overstates certainty is operationally dangerous.

---

## 5. Motion, updates, and temporal integrity

The board should auto-refresh data without visibly “reloading.” Use push updates where available or poll on a cadence appropriate to equipment telemetry; as a starting product rule, ingest heartbeats every 5–10 seconds, update the on-screen state immediately on change, and perform a silent full reconciliation every 30–60 seconds. These numbers are design targets to validate against the backend and clinical workflow, not universal safety standards. Keep the clock live, but avoid seconds unless second-level coordination is genuinely needed.

Animate only *state changes*: a new/changed card may fade and translate 8–12 px over 250–400 ms, then become completely still. A changed number may cross-fade; do not count it up because the intermediate values are false. Never rotate whole pages, auto-scroll lists, use a ticker, pulse the success check, or run decorative ambient loops. W3C notes that moving or auto-updating content distracts some users and requires controls when it persists; because this TV has no input, the safer interpretation is to avoid persistent motion altogether ([W3C Pause, Stop, Hide](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)). Never flash; WCAG’s general safety threshold prohibits content flashing more than three times in one second unless it is below defined thresholds ([W3C flash guidance](https://www.w3.org/WAI/WCAG20/Understanding/three-flashes-or-below-threshold)).

Show **data freshness**, not merely page-render time. The top-left metadata should read `נתונים עד 10:18 · חי` or `עודכן לפני 18 שנ׳`; after the operational freshness threshold, transform it to `המידע אינו עדכני · 2 דק׳` and suppress the healthy green treatment. IBM recommends making timestamps and freshness metadata visible to dashboard consumers and flagging data that exceeds defined freshness thresholds ([IBM on stale data](https://www.ibm.com/think/topics/stale-data)). Distinguish three times in the data model: equipment event time, last successful source heartbeat, and last screen render; only the first two determine trust.

Use a simple connection state machine with hysteresis to avoid flicker: `live → delayed → stale → offline`, and require multiple missed heartbeats before escalating. When connectivity returns, show `החיבור חודש` for about 5 seconds with a single non-looping fade, then return to normal. Maintain the last known values but visibly label them `מצב אחרון ידוע`; replacing them with zeros would falsely suggest everything cleared.

---

## 6. Hebrew RTL and bidirectional details

Make RTL structural, not cosmetic. Set `<html lang="he" dir="rtl">`, use CSS logical properties (`margin-inline`, `padding-inline`, `inset-inline-start`), and treat the **right edge as leading**. Material’s RTL guidance says reading flow begins at the top-right, text is usually right-aligned, app bars and directional components mirror, and navigation rails sit on the leading edge ([Material Design 3 RTL](https://m3.material.io/foundations/layout/bidirectionality-rtl)). This means the board’s title and highest-priority status should begin at the top-right; supporting system metadata and clock may occupy the left/trailing edge.

Do not mirror everything. Clocks remain clockwise and time direction remains LTR; Material specifically notes that time and clock/refresh symbols should not be mirrored, and that Hebrew timelines and linear progress retain LTR behavior ([Material Design 3 RTL](https://m3.material.io/foundations/layout/bidirectionality-rtl)). Use `dir="ltr"` or `<bdi>` around `10:18`, equipment IDs such as `CU-12`, ratios such as `12/12`, and mixed Latin model names, so punctuation and numerals do not jump across the Hebrew sentence. Keep metric rows visually right-aligned, but allow their numeric tokens to render internally LTR.

Use real Hebrew copy, not literal translations of English UI labels. Prefer concise operational phrasing: `זמין`, `לא זמין`, `נבדק כעת`, `עודכן לפני דקה`, `לא הוגדר`, `בטיפול`. Avoid all-caps Latin conventions, excessive letter spacing, and centered multi-line Hebrew. Verify truncation with realistic long equipment names and staff names; for the TV, two lines at full size are better than ellipsis that removes the distinguishing suffix.

Mirror directional arrows only when they express navigation or sequence. Do not mirror universal symbols such as checkmarks, power, Wi‑Fi, electrical plugs, or circular refresh. Pair every icon with a Hebrew word; an icon-only “sliders” symbol inside the current dashed empty-state circle is too ambiguous at distance and appears interactive even though the board cannot be controlled.

---

## 7. The redesigned screen, concretely

A 1080p composition should look approximately like this, read from right to left:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ציוד קריטי · המחלקה            12/12 זמינים      נתונים עד 10:18 · חי  10:18 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                              │                               │
│   ✓  כל הציוד הקריטי זמין                    │  חשמל                         │
│      12 מתוך 12 · נבדק כעת                    │  2 מחוברות · 0 התראות          │
│                                              ├───────────────────────────────┤
│   הנשמה 4/4   ניטור 5/5   שאיבה 3/3           │  עמדות עגינה                   │
│                                              │  2 מתוך 2 פעילות               │
│   פעילות אחרונה: בדיקה הושלמה לפני 3 דק׳       ├───────────────────────────────┤
│                                              │  אחראי משמרת                   │
│                                              │  לא סומן                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

In incident mode, the header summary changes to `10/12 זמינים · 1 קריטי`, the success block becomes a red-accented critical card plus an amber warning card, and the context rail remains in exactly the same place. That spatial stability matters: viewers learn where to look, and the exception draws attention by changing severity and content rather than by moving the entire interface. Important items should occupy the top and leading side for the locale, and alignment and grouping should communicate hierarchy ([Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout)).

The aesthetic should be **clinical, not futuristic**: one Hebrew sans serif, large numerals, disciplined spacing, one calm accent, no faux depth, no tiny telemetry, and no empty ornamental containers. The strongest “modern” move is not visual novelty; it is making each pixel prove that the clinic is safe, that an exception is actionable, or that the displayed data is trustworthy.

---

## Validation and rollout

Prototype both calm and abnormal states before implementation: all healthy; one critical failure; three simultaneous failures; more than three failures; nothing configured; telemetry stale; backend offline; very long Hebrew names; and power/dock faults. Test each full-screen state on the actual mounted panel from the farthest normal viewing point and from off-axis positions, in daylight and after-hours lighting. Ask staff to answer, within three seconds: “Is the clinic safe?”, “What needs attention?”, “Where is it?”, and “How fresh is this information?”

Instrument the board itself: last successful heartbeat, render errors, fullscreen/kiosk status, browser crash/relaunch, and display online state. The wall display should automatically relaunch into kiosk mode after boot and recover from a dropped network without human input. Send actionable failures to the clinic’s existing alert channel; the TV is shared situational awareness, not a guaranteed notification mechanism.

Finally, separate the **wall-board information architecture** from the **management application**. Configuration, approvals, staff marking, filters, and drill-down remain on interactive devices. The TV receives a purpose-built read-only route with no focus styles, tooltips, hover states, or hidden interactions. This separation will make the board more appealing almost automatically, because it stops trying to compress an administrative product into a distant, glanceable clinical display.
