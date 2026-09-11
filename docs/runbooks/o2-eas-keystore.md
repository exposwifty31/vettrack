# O2 · אישור Keystore מנוהל-EAS + שליפת ה-SHA-256 ל-assetlinks

> **מטרה:** לאשר ש-EAS ייצר ויאחסן keystore מנוהל (הכי פשוט; מפעיל Play App Signing), ואז לשלוף נכס-המשך יחיד — ה-SHA-256 של Play App Signing — כדי שקישורי-העומק (App Links) יעבדו בפרודקשן.
> **זמן:** דקות, בזרימת ה-build של הסוכן. **לא חוסם review**; חוסם אימות App Links חי.
> **מקורות שאומתו:** מסמכי app-signing של Expo (managed keystore נשמר בשרתי EAS; Google מחליף upload-key ב-signing-key), + `server/lib/well-known-assetlinks.ts` בקוד, 2026-08-11.

---

## חלק א' — אישור ה-keystore המנוהל (בזרימה, פעולה שלך = אישור אחד)

כשהסוכן יריץ בפעם הראשונה `eas credentials` או `eas build -p android --profile production`, EAS ישאל אם לייצר keystore חדש. **מה שצריך לקרות:**

1. כשמופיעה השאלה **"Generate a new Android Keystore?"** → אשר **Yes**.
2. EAS מייצר את ה-keystore **ומאחסן אותו מוצפן בשרתי Expo**. אינך צריך לשמור קובץ מקומית ואינך צריך לנהל סיסמאות — זה כל היתרון של המסלול המנוהל.
3. זהו. אין פעולה נוספת שלך בשלב זה.

> למה זה "הכי פשוט": ה-keystore המנוהל הוא ה-**upload key**. בהעלאה הראשונה ל-Play, Google מפעיל **Play App Signing** — הוא מחזיק את מפתח-החתימה האמיתי (signing key) ומחתים-מחדש כל התקנה שיוצאת מהחנות. אם ה-upload key אי-פעם ילך לאיבוד, אפשר לאפס אותו מול Google בלי לאבד את האפליקציה.

**חלופה (רק אם תתעקש לנהל בעצמך):** לספק keystore קיים דרך `eas credentials`. לא מומלץ — מוסיף ניהול-סודות ידני בלי תועלת. השאר מנוהל-EAS.

---

## חלק ב' — נכס-ההמשך היחיד שאתה חייב לשלוף: Play App Signing SHA-256

לאחר שה-AAB הראשון **הועלה** ל-Play (Internal testing מספיק), Google מייצר את ה-**signing-key certificate**. ה-SHA-256 שלו קיים **רק אחרי ההעלאה הראשונה**, וחייב להיכנס לשרת כדי ש-`https://vettrack.uk/.well-known/assetlinks.json` יאמת התקנות שיצאו מהחנות.

### לשלוף את ה-SHA-256:
1. Play Console → `uk.vettrack.app` → תפריט **Test and release → Setup → App integrity** (בגרסאות ישנות: **App signing**).
2. תחת **App signing key certificate** → העתק את ערך **SHA-256 certificate fingerprint** (פורמט hex עם נקודתיים, למשל `AB:CD:12:...`).
   > שים לב: יש שם **שני** אישורים — "App signing key" ו-"Upload key". אתה צריך את זה של **App signing key** (זה שגוגל חותם בו את מה שיוצא לחנות).
3. מסור לי את הערך (או הדבק אותו ישירות — ראה חלק ג').

### חלק ג' — היכן זה מוזן (רקע; צד-סוכן, כבר מחווט)
- השרת קורא את ה-SHA-256 של Play App Signing ממשתנה-הסביבה **`ANDROID_PLAY_SIGNING_SHA256`** בזמן-ריצה (`server/lib/well-known-assetlinks.ts`) ומגיש אותו **בנוסף** ל-fingerprint הקבוע של מפתח-ההעלאה. אין מערך לעריכה ואין TODO בקוד — משתנה-הסביבה הוא המנגנון היחיד.
- הזרימה: אתה שולף ומוסר את ה-SHA-256 → אני קובע את `ANDROID_PLAY_SIGNING_SHA256` על Railway ועושה redeploy → אימות: `curl https://vettrack.uk/.well-known/assetlinks.json` מציג **שני** fingerprints.
- עד שהמשתנה מוגדר, השרת מגיש את מפתח-ההעלאה בלבד ורושם אזהרה חד-פעמית בלוג — התקנות מהחנות לא יאמתו App Links עד ההזנה.

### סטטוס 2026-09-10 — בוצע

<!-- vt-claim: attested assetlinks-two-fingerprints-2026-09-10 -->

- `ANDROID_PLAY_SIGNING_SHA256` **מוגדר** על שירות `VetTrack` ב-Railway (ערך ה-App signing key מ-Play Console, `C4:17:D1:…:CE:3E`).
- `https://vettrack.uk/.well-known/assetlinks.json` מגיש **שני** fingerprints: הקבוע `93:34:4C:…:5C:83` מהקוד + `C4:17:…` מהמשתנה. אומת ב-`curl` אחרי ה-redeploy.
- **~~פער פתוח, לא תוקן~~ — נסגר 2026-09-11:** `keytool -printcert -jarfile` על ה-AAB 10302 (הורד מ-EAS, חתום לפני ש-Play חותם מחדש) מחזיר `38:31:8A:51:…:4F:5F` — זהו ה-keystore המנוהל של EAS, והוא ה-Upload key ש-Play Console מציג. הקבוע `93:34:…` הוא מפתח-ההעלאה המקומי של מעטפת Capacitor, לא שגוי — פשוט ליין שני. הקוד מגיש עכשיו **רשימה** `UPLOAD_KEY_CERT_FINGERPRINTS` (שני ה-upload keys) + ה-Play App Signing key מהמשתנה, כלומר שלוש טביעות אחרי ה-deploy. הטקסט המקורי, לרשומה: הקבוע `UPLOAD_KEY_CERT_FINGERPRINT` ב-`server/lib/well-known-assetlinks.ts` היה `93:34:4C:4B:9F:2D:22:CC:61:DA:0C:35:71:CF:98:E5:85:22:A3:0A:CA:B8:98:17:2A:28:E7:FC:9F:82:5C:83`, בעוד ש-Play Console מציג כ-**Upload key** את `38:31:8A:51:1A:61:74:CF:F9:0A:BF:3F:8C:4B:AB:DF:B6:9B:34:F4:82:90:3F:C1:A6:F9:9D:FA:8B:A1:4F:5F`. או שהקבוע הוא מפתח-העלאה ישן (Capacitor) שכבר לא בשימוש, או שהוא שגוי. ההתקנות מהחנות מאומתות בכל מקרה דרך ה-signing key (`C4:17:…`), כך שאין תקלה בפועל — אבל הקבוע דורש הכרעה: לעדכן ל-`38:31:…`, להסיר, או להשאיר ולתעד מדוע.

---

## צד iOS — Apple credentials (אותו רעיון, פעולה מקבילה)

בזרימת ה-build ל-iOS, EAS ישאל על ניהול credentials של Apple. **בחר מסלול אחד:**

- **מסלול A (מומלץ):** אשר **EAS-managed Apple credentials** — EAS מנהל distribution certificate + provisioning profile מול חשבון ה-Apple Developer (Team ID `87F5G378M6`, כבר ב-`eas.json`). דורש התחברות ל-Apple פעם אחת (Apple ID + סיסמה + 2FA) כשהסוכן ירוץ, או —
- **מסלול B (ל-CI ללא-אינטראקציה):** ספק **App Store Connect API Key** (`.p8` + Key ID + Issuer ID) מ-App Store Connect → Users and Access → Integrations → App Store Connect API. מסור לי את השלושה ואגדיר אותם כסודות EAS. עדיף אם רוצים build-ים אוטומטיים בלי חלון-התחברות של Apple.

לאף אחד מהמסלולים אין נכס-המשך כמו ה-SHA-256 של אנדרואיד — צד iOS נסגר ברגע שה-credentials מאושרים.

---

## סיכום פעולות שלך (checklist)
1. [ ] אשר "Yes" ליצירת keystore מנוהל כשהסוכן מריץ את ה-build הראשון.
2. [x] אחרי ההעלאה הראשונה: שלוף SHA-256 של **App signing key** מ-App integrity ומסור לי. — **בוצע 2026-09-10** (ראה "סטטוס 2026-09-10" למעלה; פער ה-upload-key שם הוא נושא נפרד ופתוח).
3. [ ] iOS: אשר EAS-managed Apple credentials **או** מסור App Store Connect API Key (`.p8`+KeyID+IssuerID).
