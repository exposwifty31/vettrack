# VetTrack 1.2.0 — App Store submission copy (draft for owner approval)

App: VetTrack (`uk.vettrack.app`, ASC id 6778937527) · Live store version **1.0.1** → target **1.2.0**, build **26** · Locales: **he** (default) + **en**.

---

## "What's New" — English (en)

VetTrack 1.2 is a major update for the whole veterinary team:

• Role-based home screens tailored to vets, technicians, and students
• Command Center — a live ward wall display you can pair to any screen
• One-tap Code Blue with a shared crash-cart checklist
• Faster equipment custody and scanning, with RFID gate support
• Shift handover: an at-a-glance summary of everything that changed on shift
• Predictive readiness — reorder supplies before you run out
• Live presence and typing indicators in shift chat

Plus reliability, offline, and accessibility improvements throughout.

## "What's New" — Hebrew (he) — RTL

‏VetTrack 1.2 היא עדכון גדול לכל צוות בית החולים הווטרינרי:

• מסכי בית לפי תפקיד — לווטרינרים, טכנאים וסטודנטים
• מרכז שליטה — תצוגת קיר חיה למחלקה, שניתן לצמד לכל מסך
• קוד כחול בלחיצה אחת עם צ'ק-ליסט משותף לעגלת החייאה
• משמורת וסריקת ציוד מהירות יותר, עם תמיכה בשערי RFID
• מסירת משמרת — סיכום ברור של כל מה שהשתנה במשמרת
• מוכנות חזויה — הזמינו מלאי לפני שהוא אוזל
• נוכחות והקלדה חיים בצ'אט המשמרת

בנוסף, שיפורי יציבות, עבודה לא-מקוונת ונגישות לכל אורך האפליקציה.

---

## App Review notes (Review Information → Notes)

VetTrack is a **real native iOS app** (Capacitor), not a web wrapper. It presents **distinct native surfaces**: a mobile floor view (iPhone), an iPad master-detail workspace, and a Command Center board (kiosk wall display). Sign in with Apple, Camera (equipment scanning), NFC, and Haptics use native device capabilities. (App Review 4.2 mitigation.)

**Demo account (isolated, synthetic data only):**
- Email: `reviewer@vettrack.uk`  ·  Password: (provided in the App Review credentials field)
- Role: **vet / senior-technician** in a dedicated demo clinic with an **active shift** covering the review window (clinical authority requires a rostered clinical role).
- Contains only synthetic equipment / rooms / tasks — no real patient or client data.

**Suggested walkthrough:**
1. Sign in (Apple, Google, or the demo email/password).
2. Home → open an equipment item → check out / return (custody + scan).
3. Start a **Code Blue** → add a log entry → end it.
4. Open the **Command Center** board (or pair a display via the pairing code).
5. Open **Shift handover** to see the shift summary.

**Account deletion (Guideline 5.1.1(v)):** Settings → Danger zone → **Delete account** (also reachable from the pending screen for a freshly created account). A confirmation is required; deletion removes the account and signs out. The demo/reviewer account is intentionally protected from deletion.

---

## Owner approval checklist before submit
- [ ] "What's New" copy (en + he) reads true to what shipped
- [ ] Demo account seeded: vet/senior role + active roster shift spanning the review window; password matches the credentials field
- [ ] Screenshots current (see screenshot track) or existing 1.0.1 shots acceptable
- [ ] Build 26 uploaded + processed (VALID)
