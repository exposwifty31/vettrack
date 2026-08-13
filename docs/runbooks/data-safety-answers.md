# Google Play Data Safety — תשובות מוכנות למילוי

> **מטרה:** מענה מדויק לטופס **Data Safety** ב-Play Console (App content → Data safety) עבור `uk.vettrack.app`. עבור על הסעיפים לפי הסדר; לכל שאלה הכרעה + נימוק.
> **מקורות שאומתו בקוד, 2026-08-11:** מחיקת-חשבון בשרת = `DELETE /api/users/delete-account` (server/routes/users.ts:1363 — מוחק/מאנונימיזציה נתונים אישיים, מבטל token של Apple, מוחק את משתמש Clerk). אימות = Clerk. אין טבלאות PHI/ER/מיקום בסכימה (הוסרו במיגרציות 142–143).
>
> ⚠️ **הערת-מקור:** מערך התשובות ה"מחקרי R3" שהתבקש **לא היה זמין** (התקבל placeholder בלבד). הטיוטה שלהלן בנויה מתיאור-הבסיס המוסכם + אימות מול הקוד. **אתה חייב לאמת כל תשובה מול המצב בפועל ב-Console לפני שליחה** — במיוחד אם נוסף SDK אנליטיקה/פרסום כלשהו.

---

## סעיף 0 — שלוש שאלות-השער (למעלה בטופס)

| # | שאלה | תשובה | נימוק |
|---|---|---|---|
| 0.1 | Does your app collect or share any of the required user data types? | **Yes** | אימייל+זהות (Clerk), טוקני-push, דיאגנוסטיקה (Sentry). |
| 0.2 | Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS/TLS בכל קריאות ה-API; SSE ו-Socket.io מעל TLS. |
| 0.3 | Do you provide a way for users to request that their data be deleted? | **Yes** | מחיקה עצמית בתוך האפליקציה: `DELETE /api/users/delete-account` (מוחק/מאנונימיזציה + מבטל Clerk/Apple). ספק גם URL של מדיניות-מחיקה אם נדרש (`vettrack.uk/privacy`). |

> **חשוב — מה שהאפליקציה לא אוספת (הצהר "No" מפורש בכל קטגוריה):**
> **אין PHI / מידע רפואי של מטופלים** · **אין מעקב-מיקום (Location)** · **אין נתונים פיננסיים/תשלומים** · **אין אנשי-קשר/יומן/תמונות/מיקרופון/בריאות-כושר** · **אין מזהי-פרסום ואין mediation לפרסום**. נתוני-הציוד/התפעול הם תוכן-מערכת של המרפאה, לא נתונים אישיים של המשתמש הפרטי.

---

## סעיף 1 — Data types (סמן רק את אלה; כל השאר "Not collected")

### 1.1 Personal info → **Email address**
- Collected: **Yes** · Shared: **No**
- Processed ephemerally only: **No** (נשמר לניהול-חשבון)
- Required or optional: **Required** (חובה להתחברות)
- Purposes: **Account management** (+ **App functionality** אם רלוונטי)

### 1.2 Personal info → **User IDs** (מזהה Clerk / זהות משתמש)
- Collected: **Yes** · Shared: **No**
- Processed ephemerally: **No** · Required/optional: **Required**
- Purposes: **Account management**, **App functionality**

> אם הרשמה כוללת **שם** (name) כשדה נפרד — סמן גם **Name**, אותם ערכים (Collected/No-share/Required/Account management). אם אין שם — השאר "Not collected".

### 1.3 App info and performance → **Crash logs** + **Diagnostics**
- Collected: **Yes** · Shared: **No** (נשלח ל-Sentry כמעבד-משנה, לא "שיתוף" בהגדרת Google)
- Processed ephemerally: **No** · Required/optional: **Optional** (אם קיים opt-out) או **Required** (אם תמיד-פועל)
- Purposes: **Analytics**, **App functionality** (יציבות/דיבוג)

### 1.4 Device or other IDs → **Device or other IDs** (טוקן push)
- Collected: **Yes** · Shared: **No**
- Processed ephemerally: **No** · Required/optional: **Optional** (רק אם המשתמש מאשר התראות)
- Purposes: **App functionality** (מסירת התראות תפעוליות/חירום)

> **הבהרה:** אם ה-build המוגש **אינו** כולל עדיין רישום push חי (ראה O6 — creds push עוד לא סופקו), עדיין נכון להצהיר על טוקן-מכשיר אם הקוד רושם token. אם רישום ה-token מנוטרל ב-build המוגש — אפשר להשאיר "Device or other IDs = Not collected" עד שה-push מופעל. **אמת מול ה-build שמוגש בפועל.**

---

## סעיף 2 — Security practices (בתחתית הטופס)

| שאלה | תשובה | נימוק |
|---|---|---|
| Is data encrypted in transit? | **Yes** | TLS על כל התעבורה. |
| Can users request data deletion? | **Yes** | מחיקה עצמית בתוך האפליקציה (`DELETE /api/users/delete-account`) + כתובת מדיניות. |
| Committed to Play Families Policy? | **No** | האפליקציה אינה מיועדת לילדים. |
| Independently validated against a security standard (MASA)? | **No** | לא בוצע audit חיצוני. |

---

## סעיף 3 — לפני שליחה (checklist אימות)
1. [ ] פתח את הקוד/ה-build המוגש וּודא איזה SDK צד-שלישי פעיל בפועל (Sentry ✔; ודא שאין אנליטיקה/פרסום סמוי). כל SDK נוסף = קטגוריית-נתונים נוספת בטופס.
2. [ ] ודא ש-`push` (טוקן-מכשיר) אכן נרשם ב-build המוגש; אם לא — סמן "Not collected" בקטגוריה 1.4.
3. [ ] ודא שכתובת מדיניות-הפרטיות (`vettrack.uk/privacy` או המקבילה) חיה ומכסה את הנתונים שהוצהרו — Google מצליב בין הטופס למדיניות.
4. [ ] ודא שאין הצהרת מעקב-מיקום, נתונים פיננסיים או PHI — סתירה כאן היא סיבה נפוצה לדחייה.
5. [ ] שמור טיוטה, ואז **Submit for review** בתוך App content → Data safety.

> **תזכורת:** Data Safety הוא חלק מ-App content שחייב להיות שלם לפני שהאפליקציה יוצאת מ-draft. אין לו קשר לחסם ה-review עצמו של ה-track, אבל בלעדיו לא ניתן לקדם מ-draft. מלא במקביל להעלאת ה-AAB.
