# O1 · יצירת Google Play Service-Account JSON (פותח העלאת Android)

> **מטרה:** ליצור מפתח JSON של Service Account שיאפשר לסוכן להעלות את ה-AAB אוטומטית דרך EAS Submit ל-`uk.vettrack.app`.
> **זמן:** ~10 דקות עבודה שלך. זה **חוסם review** ל-Android — עשה קודם.
> **מקורות שאומתו:** מסמכי EAS Submit ל-Android (expo/expo) + `eas-app-stores/play-store.md`, 2026-08-11.

---

## חלק א' — Google Cloud Console: יצירת ה-Service Account

> ⚠️ **קריטי:** ה-Service Account חייב להיווצר בפרויקט ה-Google Cloud **שמקושר לחשבון ה-Play Console שלך**. אם קיים כבר קישור פרויקט ב-Play Console (Setup → API access), השתמש **באותו פרויקט**. אם אין — Play Console יציע ליצור/לקשר פרויקט; עשה זאת קודם ואז חזור לכאן.

1. היכנס ל-<https://console.cloud.google.com> עם חשבון Google שיש לו גישה לפרויקט המקושר.
2. למעלה, בבורר-הפרויקטים, ודא שנבחר **הפרויקט המקושר ל-Play**.
3. תפריט ניווט → **IAM & Admin → Service Accounts**.
4. לחץ **+ CREATE SERVICE ACCOUNT**.
5. **Service account name:** `vettrack-play-publisher` (או כל שם ברור). לחץ **CREATE AND CONTINUE**.
6. שלב "Grant this service account access" — **דלג** (Continue). לזרימת מפתח-JSON זה, ההרשאות המשמעותיות ניתנות בצד Play Console (חלק ב'), לא כאן. *(אם בהמשך `eas submit` נכשל עם שגיאת-הרשאה — חזור לצעד זה והענק לחשבון את התפקיד **Service Account User**; זה לא מזיק להוסיפו מראש אם אתה מעדיף להיות בטוח.)*
7. שלב "Grant users access" — **דלג** (Done).
8. אתה חוזר לרשימת ה-Service Accounts. **העתק את כתובת האימייל** של החשבון שנוצר — נראית כמו:
   `vettrack-play-publisher@<project-id>.iam.gserviceaccount.com`. תזדקק לה בחלק ב'.

## חלק ב' — יצירת מפתח JSON והורדתו

9. ברשימה, לחץ על ה-Service Account שיצרת → לשונית **KEYS**.
10. **ADD KEY → Create new key**.
11. בחר **JSON** → **CREATE**.
12. הדפדפן מוריד קובץ `.json` אוטומטית. **זהו הסוד** — אל תשתף במייל/צ'אט לא-מוצפן, אל תעלה ל-git.

## חלק ג' — Play Console: הזמנת ה-Service Account והרשאות שחרור

13. היכנס ל-<https://play.google.com/console>.
14. אם עוד לא קושר פרויקט Cloud: **Setup → API access** → תחת "Linked Google Cloud project" קשר את הפרויקט מחלק א' (אם כבר מקושר — דלג).
15. **הענקת הגישה — יש שני מסלולים שקולים ב-Console; בחר לפי מה שה-UI מציג:**
    - **מסלול A (הקנוני ל-EAS):** באותו מסך **Setup → API access**, מצא את ה-Service Account שיצרת ברשימה תחת "Service accounts" → **Manage Play Console permissions** (או **Grant access**).
    - **מסלול B:** תפריט **Users and permissions** (ברמת החשבון) → **Invite new users** → בשדה **Email address** הדבק את אימייל ה-Service Account מצעד 8.
16. לשונית **App permissions** → סמן **רק** את `uk.vettrack.app` (VetTrack) — הרשאה מוגבלת לאפליקציה אחת.
17. לשונית **Account permissions/Permissions** → הענק תפקיד **Release manager**. אם ה-UI מראה הרשאות-פרטניות במקום תפקיד-בשם, סמן את הסט הבא (זהו בדיוק Release-manager מבחינת ה-API): **Release apps to testing tracks** + **Release to production, exclude devices, and use Play App Signing** + **Manage testing tracks and edit tester lists** + **Manage store presence / drafts**.
18. **Apply / Invite user → Send invitation**. ל-Service Account אין תיבת-דואר — הגישה נכנסת-לתוקף מיידית, אין מייל-אישור לאשר.

## חלק ד' — מסירת ה-JSON (בחר מסלול אחד)

**מסלול A — מסירה לסוכן (מומלץ, הכי פשוט):** מסור לי את הקובץ בערוץ מאובטח ואני אעלה אותו ל-EAS (הוא נשמר מוצפן ב-KMS בשרתי Expo ומשמש חוזרות — לא נשאר על הדיסק).

**מסלול B — נתיב מוסכם מקומי:** שים את הקובץ בדיוק בנתיב:
```
/Users/dan/VetTrack-RN-Migration/google-service-account.json
```
זהו הנתיב ש-`eas.json` כבר מצפה לו (`submit.production.android.serviceAccountKeyPath`).
> ⚠️ נתיב זה **עדיין לא ב-.gitignore** של repo ה-RN. לפני שאתה שם את הקובץ שם — הודע לי ואוסיף `google-service-account.json` ל-`.gitignore` (הוא מכיל סוד; אסור שייכנס ל-git).

---

## הערות עובדתיות (חשוב לדעת)
- **ההגשה הראשונה חייבת להיעשות ידנית דרך ה-web-console** — Google לא מאפשר ל-API ליצור אפליקציה חדשה. `uk.vettrack.app` כבר קיים ב-Console, אז זה כבר מכוסה; ה-Service Account רק **מעלה גרסאות** לאפליקציה קיימת.
- אחרי ההגשה הראשונה דרך EAS, האפליקציה תישאר **בסטטוס draft** ב-Play Console עד שתשלים את store-listing / Data Safety / content-rating (ראה `data-safety-answers.md`).
- אם המפתח נחשף אי-פעם: בטל אותו ב-Google Cloud Console → Service Accounts → Keys → מחק, וצור חדש. פעולה זו לבדה מספיקה (המפתח לא יכול להגיש אפליקציה **חדשה** בשמך — רק גרסה של קיימת).

## אימות שהצליח
לאחר המסירה, הסוכן יריץ `eas submit -p android` ותראה ב-Play Console → `uk.vettrack.app` → Testing → Internal testing גרסה חדשה. אם מופיע `Service account lacks permission` — חזור לצעד 18 וּודא שתפקיד Release manager הוקצה על `uk.vettrack.app`.
