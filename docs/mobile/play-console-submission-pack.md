# VetTrack — Google Play Console Submission Pack (copy-paste ready)

> Prepared 2026-07-29 for the FIRST Play submission (distribution program, Android phase). Every
> field below is fill-ready. Grounded in the owner-locked decisions (health="no health features",
> app category Business/Productivity not Medical, no push/ads, staff-only). AAB to upload:
> `android/app/build/outputs/bundle/release/app-release.aab` (versionCode 10200, versionName 1.2.0,
> signed with the upload key, zero AD_ID). Legal URLs all verified live (200) 2026-07-29.
>
> **Account gate:** personal account created after 2023-11-13 → **12 opted-in testers × 14 continuous
> days closed testing before production**. Confirm developer-identity verification shows complete
> BEFORE filling forms (it can block publishing and take days).
>
> **⚠️ Three account-verification gates block publishing (all required, do them first):**
> 1. **Identity** — upload a government document. **Takes several days** — start it TODAY, it's the
>    slowest gate.
> 2. **Android device access** — install the **"Google Play Console"** app on a **PHYSICAL, non-rooted,
>    Android 10+ device** (emulators are explicitly NOT accepted — Google policy, verified 2026-07-29),
>    sign in, confirm. Takes <1 minute; the same device can verify multiple accounts. Owner has no
>    Android device → **borrow one for one minute** (a tester's phone during recruitment is ideal),
>    then remove the account and hand it back.
> 3. **Contact phone number** — SMS/verification.

---

## 0. Create app (Play Console → Create app)

| Field | Value |
|---|---|
| App name | `VetTrack` |
| Default language | **Hebrew (עברית) – `he-IL`** |
| App or game | App |
| Free or paid | **Free** ⚠️ irreversible — a free app can never become paid |
| Declarations | Developer Program Policies ✓ · US export laws ✓ |

Then: **Test and release → Managed publishing → ON** (before filling anything, so nothing auto-publishes).

---

## 1. App access (App content → App access) — REQUIRED

Select **"All or some functionality is restricted"**. Add one instruction set.
**Use a dedicated, least-privileged demo account seeded with SYNTHETIC data** (the same one used in
App Store Connect review notes) — NOT a real admin or a staff member's personal account. The reviewer
and the automatic pre-launch crawler will sign in and exercise the app; the account should hold no
real clinic/patient data and only the role needed to demonstrate the flows (e.g. `technician`, not
`admin`). Rotate this account's password after review.

- **Name:** `Reviewer / staff login`
- **Username:** *(the dedicated synthetic-data demo reviewer email — same as ASC review notes)*
- **Password:** *(the same REVIEWER_PASSWORD)*
- **Any other instructions:**
```
Sign in with the email + password above using the "התחבר / Sign in" email path
(NOT the Google/Apple OAuth buttons). After sign-in you land on the operations
dashboard. NFC and haptics require a physical device; on an emulator use the
in-app manual scan fallback. Code Blue (emergency) screens require network.
Hebrew is the default UI language; English is available in Settings.
```
(These credentials are also reused by the automatic Pre-launch report crawler.)

---

## 2. App content declarations (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | `https://vettrack.uk/privacy` |
| Ads | **No, my app does not contain ads** |
| Target audience & content | Target age group: **18 and over only** (keeps the app out of the Families program) |
| News app | No |
| COVID-19 contact tracing/status | No |
| Data safety | see §4 |
| Government app | No |
| Financial features | None |
| **Health apps** | **"My app doesn't have any health features"** — veterinary is NOT human health; do not self-classify into a human-health category |
| Content rating | see §3 |

---

## 3. Content rating (IARC questionnaire)

| Prompt | Answer |
|---|---|
| Email (published to IARC) | *(real support/contact email)* |
| Category | **Utility, Productivity, Communication, or Other** (NOT a game category) |
| Violence / does the app contain violence? | **No** — the app ships no violent content; any staff-uploaded photo is handled under the UGC row below, not here |
| Sexuality / nudity | No |
| Language (profanity) | No |
| Controlled substances — does the app reference/depict illegal drugs, alcohol, tobacco? | **No** — professional veterinary dosing references are not depictions of illegal drug use |
| Gambling | No |
| User-generated content / user interaction / shares location | **⚠️ OWNER DECISION — do not blind-answer "No".** Google defines UGC as user-contributed content accessible to ANY subset of users, so "private/closed-clinic" does NOT auto-exempt it. VetTrack lets staff upload equipment **issue photos** visible to other clinic staff → that likely **counts as UGC**. If so, answer **Yes**, which triggers Google's UGC obligations: a **content policy / terms**, an **in-app report/flag mechanism**, and a **moderation/takedown flow** for the photos. Confirm the actual visibility scope of issue photos, then answer accordingly. Location sharing → No (no location collected). |
| Miscellaneous | No |

→ If UGC=No, expect an "Everyone / PEGI 3" style rating. **If UGC=Yes, the rating and the required
UGC controls change** — reassess before publishing; re-certify whenever functionality changes.

---

## 4. Data safety form (Policy → App content → Data safety)

**Data collected (all: collected, encrypted in transit, NOT shared with third parties, NOT
processed ephemerally where a real account record exists):**

| Data type | Category | Collected? | Purpose | Optional? |
|---|---|---|---|---|
| Email address | Personal info | Yes | Account management, App functionality | Required |
| Name | Personal info | Yes | Account management, App functionality | Required |
| User IDs (Clerk user id) | Personal info | Yes | Account management, App functionality | Required |
| Photos (equipment issue photos, avatar) | Photos & videos | Yes | App functionality | Optional |
| Other info (veterinary license number) | Personal info | Yes | App functionality | Optional |
| App activity (equipment scans, tasks) | App activity | Yes | App functionality, Analytics | Required |

**Explicitly NOT collected / declared NO:**
- **Advertising ID → No** (verified: the AAB manifest has zero `com.google.android.gms.permission.AD_ID`).
- **Push tokens / messaging → No** (the shipped app registers no push on either platform).
- Location → No · Financial info → No · Health & fitness → No · Contacts → No · Browsing history → No · Precise/approximate location → No.

**Security & deletion:**
- Data is encrypted in transit → **Yes**.
- Users can request data deletion → **Yes** — provide the deletion URL: `https://vettrack.uk/account-deletion` (and note in-app: Settings → Danger zone → Delete account).
- **Independent security review** (the "has your app been independently reviewed against a security standard, e.g. MASA?") → **No** (separate question — answer honestly; we have not undergone a MASA/OWASP MASVS review).
- **Families policy** → **Not applicable** (target audience is 18+, §2 — the app is not in the Families/Designed-for-Families program; this is a distinct declaration from the security-review one above).

---

## 5. Store listing (Grow → Store presence → Main store listing)

Default language **he-IL** must be complete; **en-US** is added as a translation. Both below.

### App name (30 chars)
| Locale | Value |
|---|---|
| he-IL | `VetTrack` |
| en-US | `VetTrack` |

### Short description (80 chars)
| Locale | Value |
|---|---|
| he-IL | `ניהול תפעולי לבתי חולים וטרינריים — ציוד, משימות ומלאי בזמן אמת` |
| en-US | `Veterinary hospital operations — equipment, tasks & inventory in real time` |

### Full description (4000 chars)

**he-IL:**
```
VetTrack היא פלטפורמת התפעול לבתי חולים וטרינריים.

עקבו אחר כל פריט ציוד בין החדרים והמחלקות בזמן אמת. סרקו תגי NFC וברקודים
כדי להוציא ולהחזיר ציוד, לתעד תאריכי עיקור, לדווח על תקלות ולקבל התראות
אוטומטיות על איחורים — הכול מהטלפון.

מעקב ציוד
• ראדאר ציוד חדר־אחר־חדר בזמן אמת
• זרימות סריקת NFC ו־QR להוצאה והחזרה
• דיווח תקלות עם צילום ראיה
• תזכורות תפוגה ותחזוקה אוטומטיות
• הסברי Asset Copilot למצב הציוד

משימות
• רשימת משימות מאוחדת לתפעול הרצפה
• הקצאה, מעקב והשלמה של משימות תפעוליות
• זרימות עבודה מבוססות־תפקיד לווטרינרים ולטכנאים

מלאי ורכש
• רמות מלאי חיות למכלים ולפריטים
• הזמנות רכש וזרימות חידוש מלאי
• אירועי ניפוק עם נתיב ביקורת מלא

Code Blue ולוח מחלקה
• תיאום מצבי חירום Code Blue
• בדיקות מלאי עגלת החייאה
• לוח ציוד מחלקתי עם עדכוני זמן־אמת

מוכן לריבוי מרפאות
• אפליקציה אחת לכמה מרפאות עם בידוד נתונים מוחלט
• גישה מבוססת־תפקיד: מנהל, וטרינר, טכנאי בכיר, טכנאי, סטודנט
• ממשק בעברית ובאנגלית

אמינות
• עובד גם ללא חיבור — סנכרון רקע מתחדש אוטומטית לאחר ניתוק
• בנוי לצוותים וטרינריים עמוסים שצריכים תשובה מיידית: איפה הציוד,
  מי מחזיק בו, ומה הבא בתור.

VetTrack מיועדת לצוותי בתי חולים וטרינריים — לא לאבחון או טיפול רפואי בבעלי חיים.
```

**en-US:**
```
VetTrack is the operations platform for veterinary hospitals.

Track every piece of equipment across rooms and wards in real time. Scan NFC
tags and barcodes to check equipment in and out, record sterilisation dates,
report issues, and receive automatic overdue alerts — all from your phone.

EQUIPMENT TRACKING
• Real-time room-by-room equipment radar
• NFC and QR scan workflows for check-out and return
• Issue reporting with photo evidence
• Automatic expiry and maintenance reminders
• Asset Copilot explanations for equipment status

TASKS
• Unified task list for floor operations
• Assign, track, and complete operational tasks
• Role-based workflows for vets and technicians

INVENTORY & PROCUREMENT
• Live stock levels for containers and items
• Purchase orders and restock workflows
• Dispense events with a full audit trail

CODE BLUE & WARD BOARD
• Code Blue emergency session coordination
• Crash cart inventory checks
• Ward equipment board with real-time updates

MULTI-CLINIC READY
• One app serves multiple clinics with strict data isolation
• Role-based access: admin, vet, senior technician, technician, student
• Hebrew and English interfaces

RELIABILITY
• Works offline — background sync resumes automatically after a dropout
• Built for busy veterinary teams who need instant answers about where
  equipment is, who has it, and what's due next.

VetTrack is an operations tool for veterinary teams — not for animal medical
diagnosis or treatment.
```

### Graphic assets

| Asset | Spec | Source / note |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤1 MB, full-bleed (Play masks corners) | export from the same VT mark as the in-app adaptive icon (bg `#0B1021`) |
| Feature graphic | 1024×500 JPG or 24-bit PNG, **no alpha** — REQUIRED | VT logo on `#0B1021`, product name |
| Phone screenshots | 2–8, 1080×1920 (9:16), ≥3 at that size for featuring eligibility | sequence below |
| 7" tablet | 2–8, ≥1200px | same sequence, tablet layout |
| 10" tablet | 2–8, ≥1920px landscape | board/console views shine here |

**Screenshot sequence (capture on the Pixel_API_36 emulator — same one already running):**
1. Home/Today dashboard (shift summary + alerts)
2. Equipment radar (room grid, status)
3. Equipment detail → check-out / NFC flow
4. Task list (`/equipment/tasks`)
5. Code Blue session view
6. Inventory dashboard
7. (tablet only) Ward board / console

Localize each into he + en, or mark reusable. Agent can drive the capture on request.

---

## 6. Countries / regions (per track)

- **Closed testing track:** Israel (IL) + **every tester's Play-account country** (a tester whose
  country is excluded cannot opt in). Add UK (GB) if any tester is there.
- **Production (later):** IL + GB to start; expand as needed.

---

## 7. Closed testing track (Test and release → Testing → Closed testing)

1. Create a closed-testing track (current Play Console lets you name it — e.g. `closed-testing`; the
   legacy fixed "Alpha/Beta" names are gone, so use whatever the console offers).
2. **Testers:** add an email list of the 12–16 Google accounts (or a Google Group). List cap 2000.
3. Upload `app-release.aab`; write release notes (he + en, see §8); roll out.
4. First release passes **app review — budget up to ~7 days for a brand-new app/account.**
5. When live, share the opt-in URL: `https://play.google.com/apps/testing/uk.vettrack.app`
   Each tester opens it signed into their listed account → Accept → install via the Play link.
6. **Clock:** starts only when the release is live AND ≥12 opted in; it is a **rolling 14-day window**
   — a dip below 12 restarts it; mid-window AAB updates (bug fixes → versionCode 10201+) do NOT reset it.

---

## 8. Release notes (What's new — per release)

**he-IL:**
```
• מעקב ציוד תפעולי: סריקה, משימות, מלאי ו־Code Blue
• לוח מחלקה בזמן אמת וזרימות ציוד גם ללא חיבור
• ממשק בעברית ובאנגלית
```
**en-US:**
```
• Equipment-first operations: tracking, tasks, inventory, Code Blue
• Real-time ward board and offline-capable equipment workflows
• Hebrew and English interface
```

---

## 9. Post-upload checklist

- [ ] Pre-launch report (Test and release → Pre-launch report): runs automatically when an AAB reaches a testing track; review the **crashes/ANRs**, **security & trust**, **accessibility**, and **performance** tabs (advisory, non-blocking). Ensure the crawler can sign in — set the credentials under **Pre-launch report → Settings → Credentials** (the §1 App-access account); without them the crawler only sees the login wall.
- [ ] After the first AAB is processed: Play auto-enrolls **Play App Signing** — accept the Google-generated app-signing key (do NOT supply your own). Copy its **SHA-256** from **App integrity → App signing**, and **append it to `server/lib/well-known-assetlinks.ts`** (the NFC/QR App Links). Keep BOTH fingerprints in the array: the **Play app-signing key** (Play-delivered installs — the one that actually verifies in production) AND the **upload key** (sideloaded/testing installs). `sha256_cert_fingerprints` accepts multiple; then redeploy so `/.well-known/assetlinks.json` serves both.
- [ ] **Rotate the upload key — MANDATORY, treat as compromised.** The current upload-key password was displayed in this session's transcript, so the key must be considered exposed. Do this before relying on the app in production: App integrity → Upload key → **request upload key reset** (generate a fresh keystore + password stored ONLY in the password manager, update `android/keystore.properties`). The app itself stays safe because Google holds the app-signing key, but a leaked upload key lets someone submit builds as you until it's reset.
- [ ] When ≥12 testers have been opted in continuously for 14 days → submit the **production access application** (a reviewed form about who the testers were, recruitment, feedback — answer substantively; thin answers get rejected).

---

## Deltas from the old `store-metadata.md` (why this file exists)

The prior `docs/mobile/store-metadata.md` is **iOS-oriented and stale** (says v1.0.1/build 20; today
is 1.2.0/build 26→27 iOS and versionCode 10200 Android). It also lacks everything Play-specific:
Hebrew copy, Data safety, IARC answers, App access, health/ads/target-age declarations, and it lists
**Category = Medical** + Play tags including "Medical/Health" — which this pack deliberately
**overrides** (Business/Productivity, health="no health features") to keep VetTrack off Google's
human-health review path (it is a veterinary operations tool). Use THIS file for the Play submission;
the iOS resubmission keeps using the ASC data via `scripts/verify-resubmission.sh`.
