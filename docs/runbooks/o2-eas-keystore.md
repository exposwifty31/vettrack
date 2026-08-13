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

---

## צד iOS — Apple credentials (אותו רעיון, פעולה מקבילה)

בזרימת ה-build ל-iOS, EAS ישאל על ניהול credentials של Apple. **בחר מסלול אחד:**

- **מסלול A (מומלץ):** אשר **EAS-managed Apple credentials** — EAS מנהל distribution certificate + provisioning profile מול חשבון ה-Apple Developer (Team ID `87F5G378M6`, כבר ב-`eas.json`). דורש התחברות ל-Apple פעם אחת (Apple ID + סיסמה + 2FA) כשהסוכן ירוץ, או —
- **מסלול B (ל-CI ללא-אינטראקציה):** ספק **App Store Connect API Key** (`.p8` + Key ID + Issuer ID) מ-App Store Connect → Users and Access → Integrations → App Store Connect API. מסור לי את השלושה ואגדיר אותם כסודות EAS. עדיף אם רוצים build-ים אוטומטיים בלי חלון-התחברות של Apple.

לאף אחד מהמסלולים אין נכס-המשך כמו ה-SHA-256 של אנדרואיד — צד iOS נסגר ברגע שה-credentials מאושרים.

---

## סיכום פעולות שלך (checklist)
1. [ ] אשר "Yes" ליצירת keystore מנוהל כשהסוכן מריץ את ה-build הראשון.
2. [ ] אחרי ההעלאה הראשונה: שלוף SHA-256 של **App signing key** מ-App integrity ומסור לי.
3. [ ] iOS: אשר EAS-managed Apple credentials **או** מסור App Store Connect API Key (`.p8`+KeyID+IssuerID).
