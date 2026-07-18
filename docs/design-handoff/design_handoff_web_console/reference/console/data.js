/* VetTrack Web Management Console — prototype data + bilingual strings.
   Strings are {e,h} pairs; t(v,locale) resolves. Numbers isolate for RTL at render time. */
window.VTDATA = (function () {
  const L = (e, h) => ({ e, h });

  const clinic = { name: L('Ramat-Gan Veterinary', 'וטרינרית רמת-גן'), sub: L('Your clinic', 'המרפאה שלך') };

  const personas = {
    admin: { initials: 'MA', name: L('Maya Arad', 'מאיה ארד'), role: L('Administrator', 'מנהל/ת מערכת') },
    lead:  { initials: 'RL', name: L('Roi Levi', 'רועי לוי'),  role: L('Lead · senior tech', 'אחראי · טכנאי בכיר') },
  };

  // key = module id; groups keep <=7 top-level entries
  const nav = [
    { header: L('Overview', 'סקירה') },
    { id: 'home', label: L('Management Home', 'דף הבית'), icon: 'home' },
    { header: L('People', 'צוות') },
    { id: 'people', label: L('People & Roles', 'צוות ותפקידים'), icon: 'users' },
    { header: L('Assets', 'נכסים') },
    { id: 'equipment', label: L('Equipment Governance', 'ניהול ציוד'), icon: 'box' },
    { id: 'inventory', label: L('Inventory & Procurement', 'מלאי ורכש'), icon: 'pkg', badge: '12' },
    { header: L('Connectivity', 'קישוריות') },
    { id: 'integrations', label: L('Integrations', 'אינטגרציות'), icon: 'plug' },
    { id: 'notifications', label: L('Notifications', 'הודעות'), icon: 'bell' },
    { id: 'rfid', label: L('RFID Readers', 'קוראי RFID'), icon: 'radio' },
    { header: L('Operations', 'תפעול') },
    { id: 'ops', label: L('Ops Health', 'תקינות תפעולית'), icon: 'activity', badge: '2', danger: true },
    { id: 'analytics', label: L('Analytics & Reports', 'ניתוח ודוחות'), icon: 'chart' },
    { id: 'audit', label: L('Audit', 'יומן ביקורת'), icon: 'shield' },
  ];

  const crumb = {
    home: L('Overview', 'סקירה'), people: L('People', 'צוות'), equipment: L('Assets', 'נכסים'),
    inventory: L('Assets', 'נכסים'), integrations: L('Connectivity', 'קישוריות'),
    notifications: L('Connectivity', 'קישוריות'), rfid: L('Connectivity', 'קישוריות'),
    ops: L('Operations', 'תפעול'), analytics: L('Operations', 'תפעול'), audit: L('Operations', 'תפעול'),
  };
  const title = {
    home: L('Management Home', 'דף הבית'), people: L('People & Roles', 'צוות ותפקידים'),
    equipment: L('Equipment Governance', 'ניהול ציוד'), inventory: L('Inventory & Procurement', 'מלאי ורכש'),
    integrations: L('Integrations & Webhooks', 'אינטגרציות ו-Webhooks'), notifications: L('Notifications', 'הודעות'),
    rfid: L('RFID Readers', 'קוראי RFID'), ops: L('Ops Health', 'תקינות תפעולית'),
    analytics: L('Analytics & Reports', 'ניתוח ודוחות'), audit: L('Audit', 'יומן ביקורת'),
  };

  const t = {
    readonly: L('Read-only', 'קריאה בלבד'),
    leadBanner: L('Viewing as Lead — read-only. Configuration changes require an admin.', 'צפייה כאחראי — קריאה בלבד. שינויי תצורה דורשים מנהל.'),
    search: L('Search users, assets, logs…', 'חיפוש משתמשים, ציוד, יומנים…'),
    viewAll: L('View all', 'הצג הכל'), close: L('Close', 'סגירה'), masked: L('Masked', 'מוסתר'),
    frozen: L('Read-only', 'קריאה בלבד'),
  };

  // ---------- HOME ----------
  const home = {
    readinessTitle: L('Equipment readiness', 'מוכנות הציוד'),
    pct: '87%', ready: L('Ready', 'מוכן'),
    caption: L('186 of 214 assets ready across 6 rooms', '186 מתוך 214 נכסים מוכנים ב-6 חדרים'),
    legend: [
      { label: L('Ready', 'מוכן'), n: '168', c: 'rgb(52 199 89)' },
      { label: L('Sterilized', 'מעוקר'), n: '18', c: 'rgb(0 122 255)' },
      { label: L('Maintenance', 'תחזוקה'), n: '12', c: 'rgb(255 149 0)' },
      { label: L('Stale', 'מיושן'), n: '8', c: 'rgb(175 82 222)' },
      { label: L('Issue', 'תקלה'), n: '6', c: 'rgb(255 59 48)' },
      { label: L('Unknown', 'לא ידוע'), n: '2', c: 'rgb(142 142 147)' },
    ],
    donut: 'conic-gradient(rgb(52 199 89) 0deg 282.6deg,rgb(0 122 255) 282.6deg 312.9deg,rgb(255 149 0) 312.9deg 333.1deg,rgb(175 82 222) 333.1deg 346.5deg,rgb(255 59 48) 346.5deg 356.6deg,rgb(142 142 147) 356.6deg 360deg)',
    exTitle: L('Needs attention', 'דורש טיפול'),
    exceptions: [
      { sev: 'issue', to: 'equipment', title: L('Readiness rule overdue', 'כלל מוכנות באיחור'), meta: L('Equipment Governance · 3 asset types', 'ניהול ציוד · 3 סוגי נכסים'), owner: L('Unassigned', 'לא משויך'), first: '08:12', entity: 'rule:ready-24h', body: L('Three asset types missed their 24h readiness-check window. Assets stay deployable but are flagged until re-checked.', 'שלושה סוגי נכסים פספסו את חלון בדיקת המוכנות (24 שע׳). הנכסים נותרים זמינים לפריסה אך מסומנים עד לבדיקה חוזרת.') },
      { sev: 'stale', to: 'equipment', title: L('Ventilator VT-204 · stale custody 26h', 'מנשם VT-204 · החזקה מיושנת 26 שע׳'), meta: L('Equipment · ICU-2', 'ציוד · טיפול נמרץ-2'), owner: L('D. Cohen', 'ד. כהן'), first: 'Yesterday 06:40', entity: 'asset:VT-204', body: L('No scan on this asset for 26h while checked out. Custody is shown as last-known; a room sweep will refresh it.', 'לא בוצעה סריקה על נכס זה במשך 26 שע׳ בזמן השאלה. ההחזקה מוצגת לפי הידוע אחרון; סריקת חדר תרענן אותה.') },
      { sev: 'issue', to: 'ops', title: L('Outbox DLQ · 2 items', 'תור נכשלים DLQ · 2 פריטים'), meta: L('Ops Health · dead-letter queue', 'תקינות תפעולית · תור נכשלים'), owner: L('System', 'מערכת'), first: '07:55', entity: 'dlq:outbox', body: L('Two outbox events failed delivery and moved to the DLQ. This surface is read-only — replay happens in the ops runbook.', 'שני אירועי outbox נכשלו במסירה ועברו ל-DLQ. משטח זה לקריאה בלבד — הרצה מחדש מתבצעת ב-runbook התפעולי.') },
      { sev: 'maint', to: 'notifications', title: L('WhatsApp delivery failed ×4', 'משלוח WhatsApp נכשל ×4'), meta: L('Notifications · last 1h', 'הודעות · השעה האחרונה'), owner: L('System', 'מערכת'), first: '08:30', entity: 'channel:whatsapp', body: L('Four notification sends failed on the WhatsApp channel. Check the provider credential (masked) and template status.', 'ארבע שליחות התראה נכשלו בערוץ WhatsApp. בדקו את פרטי הספק (מוסתרים) ואת מצב התבנית.') },
      { sev: 'issue', to: 'rfid', title: L('RFID reader ICU-Dock offline', 'קורא RFID ICU-Dock לא מקוון'), meta: L('RFID Readers · no heartbeat 12m', 'קוראי RFID · ללא פעימה 12 דק׳'), owner: L('Unassigned', 'לא משויך'), first: '08:18', entity: 'reader:icu-dock-3', body: L('No heartbeat from the ICU dock reader for 12 minutes. Custody auto-capture at this dock is paused until it reconnects.', 'לא התקבלה פעימה מקורא העגינה ב-ICU במשך 12 דקות. לכידת החזקה אוטומטית בעגינה זו מושהית עד לחיבור מחדש.') },
      { sev: 'stale', to: 'inventory', title: L('12 low-stock items', '12 פריטי מלאי נמוך'), meta: L('Inventory · below par', 'מלאי · מתחת לרף'), owner: L('R. Levi', 'ר. לוי'), first: 'Today', entity: 'inv:below-par', body: L('Twelve consumable items are below par level. Start a restock session or raise a purchase order to replenish.', 'שנים-עשר פריטים מתכלים נמצאים מתחת לרף. פתחו חידוש מלאי או צרו הזמנת רכש לחידוש.') },
    ],
    peopleTitle: L('Team on shift', 'צוות במשמרת'), onShift: '7', ofStaff: L('of 23 staff', 'מתוך 23 עובדים'),
    avatars: { e: ['MA', 'RL', 'DC', 'SA', 'YT'], h: ['מא', 'רל', 'דכ', 'סא', 'ית'] }, more: '+2',
    nextHandoff: L('Next handoff 14:00', 'חילוף הבא 14:00'), manageRoles: L('Manage roles', 'ניהול תפקידים'),
    invTitle: L('Inventory', 'מלאי'), lowStock: '12', below: L('items below par', 'פריטים מתחת לרף'),
    invRows: [
      { l: L('Open restock', 'חידוש פעיל'), v: L('1 in progress', '1 בתהליך') },
      { l: L('Purchase orders', 'הזמנות רכש'), v: L('3 pending', '3 ממתינות') },
    ],
    newRestock: L('New restock', 'חידוש חדש'),
    connTitle: L('Connectivity', 'קישוריות'),
    connRows: [
      { l: L('PMS sync (Provet)', 'סנכרון PMS (Provet)'), v: L('Synced 4m ago', 'סונכרן לפני 4 דק׳'), st: 'ok', s: L('Live', 'פעיל') },
      { l: L('Webhook delivery', 'משלוח Webhook'), v: L('99.2% · last 24h', '99.2% · 24 שע׳'), st: 'ok', s: L('Healthy', 'תקין') },
      { l: L('RFID readers', 'קוראי RFID'), v: L('6 of 7 online', '6 מתוך 7 מקוונים'), st: 'maint', s: L('Degraded', 'מוגבל') },
    ],
    opsTitle: L('Ops Health', 'תקינות תפעולית'),
    opsRows: [
      { l: L('Sync queue', 'תור סנכרון'), v: L('Healthy', 'תקין'), st: 'ok' },
      { l: L('Outbox DLQ', 'תור נכשלים DLQ'), v: L('2 items', '2 פריטים'), st: 'issue' },
      { l: L('Display heartbeats', 'פעימות תצוגה'), v: L('4 of 4 live', '4 מתוך 4 פעילים'), st: 'ok' },
    ],
    activityTitle: L('Recent activity', 'פעילות אחרונה'),
    activity: [
      { ini: { e: 'MA', h: 'מא' }, brand: true, actor: L('M. Arad', 'מ. ארד'), action: L('updated role for', 'עדכנה תפקיד עבור'), target: L('D. Cohen → Technician', 'ד. כהן לתפקיד טכנאי'), when: L('2m ago', 'לפני 2 ד׳') },
      { ini: { e: 'SY', h: 'מע' }, brand: false, actor: L('System', 'מערכת'), action: L('rotated webhook secret', 'החליפה סוד Webhook'), target: L('Provet PMS', 'Provet PMS'), when: L('18m ago', 'לפני 18 ד׳') },
      { ini: { e: 'RL', h: 'רל' }, brand: false, actor: L('R. Levi', 'ר. לוי'), action: L('opened restock session', 'פתח חידוש מלאי'), target: L('ICU crash cart', 'עגלת החייאה ICU'), when: L('1h ago', 'לפני שעה') },
    ],
  };

  // ---------- PEOPLE ----------
  const roleMeta = {
    admin: { label: L('Admin', 'מנהל'), dot: 'rgb(79 70 229)' },
    vet: { label: L('Vet', 'וטרינר'), dot: 'rgb(0 122 255)' },
    senior_technician: { label: L('Senior technician', 'טכנאי בכיר'), dot: 'rgb(52 199 89)' },
    technician: { label: L('Technician', 'טכנאי'), dot: 'rgb(142 142 147)' },
    student: { label: L('Student', 'סטודנט'), dot: 'rgb(175 82 222)' },
  };
  const statusMeta = { on_shift: { label: L('On shift', 'במשמרת'), st: 'ok' }, off_duty: { label: L('Off duty', 'לא במשמרת'), st: 'unknown' }, invited: { label: L('Invited', 'הוזמן'), st: 'steril' } };
  const shiftMeta = { morning: { label: L('Morning', 'בוקר'), st: 'ok' }, evening: { label: L('Evening', 'ערב'), st: 'steril' }, night: { label: L('Night', 'לילה'), st: 'brand' }, off: { label: '—' } };
  const people = {
    roleMeta, statusMeta, shiftMeta,
    tabs: [['users', L('Users', 'משתמשים')], ['shifts', L('Shifts', 'משמרות')]],
    cols: [L('Name', 'שם'), L('Role', 'תפקיד'), L('Status', 'סטטוס'), L('Last active', 'פעילות אחרונה')],
    invite: L('Invite user', 'הזמנת משתמש'), editRoster: L('Edit roster', 'עריכת סידור'),
    users: [
      { ini: { e: 'MA', h: 'מא' }, name: L('Maya Arad', 'מאיה ארד'), email: 'maya.arad@rg-vet.co.il', role: 'admin', status: 'on_shift', last: L('Active now', 'פעילה כעת'), shift: 'morning', since: L('Mar 2023', 'מרץ 2023') },
      { ini: { e: 'NB', h: 'נב' }, name: L('Dr. Noa Bar', 'ד״ר נועה בר'), email: 'noa.bar@rg-vet.co.il', role: 'vet', status: 'on_shift', last: L('5m ago', 'לפני 5 ד׳'), shift: 'evening', since: L('Jan 2024', 'ינואר 2024') },
      { ini: { e: 'RL', h: 'רל' }, name: L('Roi Levi', 'רועי לוי'), email: 'roi.levi@rg-vet.co.il', role: 'senior_technician', status: 'on_shift', last: L('2m ago', 'לפני 2 ד׳'), shift: 'morning', since: L('Sep 2022', 'ספטמבר 2022') },
      { ini: { e: 'SA', h: 'שא' }, name: L('Sara Adler', 'שרה אדלר'), email: 'sara.adler@rg-vet.co.il', role: 'technician', status: 'on_shift', last: L('12m ago', 'לפני 12 ד׳'), shift: 'night', since: L('Nov 2024', 'נובמבר 2024') },
      { ini: { e: 'DC', h: 'דכ' }, name: L('Dan Cohen', 'דן כהן'), email: 'dan.cohen@rg-vet.co.il', role: 'technician', status: 'off_duty', last: L('3h ago', 'לפני 3 שע׳'), shift: 'evening', since: L('Feb 2024', 'פברואר 2024') },
      { ini: { e: 'YT', h: 'ית' }, name: L('Yael Tal', 'יעל טל'), email: 'yael.tal@rg-vet.co.il', role: 'student', status: 'off_duty', last: L('Yesterday', 'אתמול'), shift: 'morning', since: L('May 2025', 'מאי 2025') },
      { ini: { e: 'OS', h: 'עש' }, name: L('Omer Shani', 'עומר שני'), email: 'omer.shani@rg-vet.co.il', role: 'technician', status: 'invited', last: L('Pending', 'ממתין'), shift: 'morning', since: L('Invited', 'הוזמן') },
    ],
    rosterHead: [[L('Sun', 'א׳'), '6'], [L('Mon', 'ב׳'), '7'], [L('Tue', 'ג׳'), '8'], [L('Wed', 'ד׳'), '9'], [L('Thu', 'ה׳'), '10']],
    staffHead: L('Staff', 'צוות'),
    roster: [
      { u: 2, cells: ['morning', 'morning', 'morning', 'off', 'evening'] },
      { u: 1, cells: ['evening', 'evening', 'off', 'morning', 'morning'] },
      { u: 3, cells: ['night', 'off', 'morning', 'morning', 'evening'] },
      { u: 4, cells: ['off', 'night', 'night', 'evening', 'off'] },
      { u: 0, cells: ['morning', 'off', 'off', 'morning', 'morning'] },
    ],
    drawer: { role: L('Role', 'תפקיד'), status: L('Status', 'סטטוס'), shift: L('Default shift', 'משמרת קבועה'), last: L('Last active', 'פעילות אחרונה'), email: L('Email', 'דוא״ל'), since: L('Member since', 'חבר/ה מאז'), activity: L('Recent activity', 'פעילות אחרונה'), save: L('Save changes', 'שמירת שינויים'), deactivate: L('Deactivate', 'השבתה'), viewAudit: L('View in Audit', 'צפייה ביומן'), leadNote: L('Role and status changes require an admin. You can review this member and open the audit trail.', 'שינויי תפקיד וסטטוס דורשים מנהל. ניתן לעיין בפרטי החבר ולפתוח את יומן הביקורת.') },
  };

  // ---------- EQUIPMENT ----------
  const equipment = {
    tabs: [['types', L('Asset types', 'סוגי נכסים'), ''], ['docks', L('Docks', 'עגינות'), ''], ['rules', L('Readiness rules', 'כללי מוכנות'), '3']],
    newType: L('New asset type', 'סוג נכס חדש'), addDock: L('Add dock', 'הוספת עגינה'), newRule: L('New rule', 'כלל חדש'),
    typeCols: [L('Type', 'סוג'), L('Category', 'קטגוריה'), L('Count', 'כמות'), L('Readiness rule', 'כלל מוכנות')],
    types: [
      { name: L('Ventilator', 'מנשם'), cat: L('Respiratory', 'נשימתי'), n: '14', rule: L('Ready ≤ 24h', 'מוכן ≤ 24 שע׳') },
      { name: L('Infusion pump', 'משאבת עירוי'), cat: L('Infusion', 'עירוי'), n: '38', rule: L('Ready ≤ 48h', 'מוכן ≤ 48 שע׳') },
      { name: L('Patient monitor', 'מוניטור'), cat: L('Monitoring', 'ניטור'), n: '26', rule: L('Ready ≤ 24h', 'מוכן ≤ 24 שע׳') },
      { name: L('Anesthesia machine', 'מכונת הרדמה'), cat: L('Surgical', 'כירורגי'), n: '8', rule: L('Ready ≤ 24h', 'מוכן ≤ 24 שע׳') },
      { name: L('Defibrillator', 'דפיברילטור'), cat: L('Emergency', 'חירום'), n: '6', rule: L('Ready ≤ 12h', 'מוכן ≤ 12 שע׳') },
      { name: L('Syringe pump', 'משאבת מזרק'), cat: L('Infusion', 'עירוי'), n: '22', rule: L('Ready ≤ 48h', 'מוכן ≤ 48 שע׳') },
    ],
    dockCols: [L('Dock', 'עגינה'), L('Location', 'מיקום'), L('Readers', 'קוראים'), L('Status', 'סטטוס'), L('Last sync', 'סנכרון אחרון')],
    docks: [
      { name: 'ICU-Dock-1', loc: L('ICU', 'טיפול נמרץ'), r: '2', st: 'ok', s: L('Online', 'מקוון'), sync: L('1m ago', 'לפני דקה') },
      { name: 'Surgery-Dock', loc: L('Surgery', 'חדר ניתוח'), r: '1', st: 'ok', s: L('Online', 'מקוון'), sync: L('3m ago', 'לפני 3 ד׳') },
      { name: 'Recovery-Dock', loc: L('Recovery', 'התאוששות'), r: '1', st: 'maint', s: L('Degraded', 'מוגבל'), sync: L('14m ago', 'לפני 14 ד׳') },
      { name: 'Store-Dock', loc: L('Storage', 'מחסן'), r: '1', st: 'issue', s: L('Offline', 'לא מקוון'), sync: L('3h ago', 'לפני 3 שע׳') },
    ],
    ruleCols: [L('Rule', 'כלל'), L('Applies to', 'חל על'), L('Window', 'חלון'), L('Status', 'סטטוס')],
    rules: [
      { name: L('24h readiness check', 'בדיקת מוכנות 24 שע׳'), applies: L('Ventilator · Monitor · Anesthesia', 'מנשם · מוניטור · הרדמה'), window: '24h', grace: '2h', sev: 'issue', owner: L('Unassigned', 'לא משויך'), st: 'issue', s: L('Overdue', 'באיחור') },
      { name: L('48h readiness check', 'בדיקת מוכנות 48 שע׳'), applies: L('Infusion pump · Syringe pump', 'משאבת עירוי · משאבת מזרק'), window: '48h', grace: '4h', sev: 'stale', owner: L('R. Levi', 'ר. לוי'), st: 'ok', s: L('Active', 'פעיל') },
      { name: L('12h crash-ready', 'מוכנות החייאה 12 שע׳'), applies: L('Defibrillator', 'דפיברילטור'), window: '12h', grace: '1h', sev: 'issue', owner: L('M. Arad', 'מ. ארד'), st: 'ok', s: L('Active', 'פעיל') },
      { name: L('Sterilization cycle', 'מחזור עיקור'), applies: L('Surgical tools', 'כלים כירורגיים'), window: '72h', grace: '6h', sev: 'maint', owner: L('N. Bar', 'נ. בר'), st: 'unknown', s: L('Paused', 'מושהה') },
    ],
    drawer: { kind: L('Readiness rule', 'כלל מוכנות'), status: L('Status', 'סטטוס'), applies: L('Applies to', 'חל על'), window: L('Check window', 'חלון בדיקה'), grace: L('Grace period', 'תקופת חסד'), sev: L('Severity when overdue', 'חומרה באיחור'), owner: L('Owner', 'אחראי'), save: L('Save changes', 'שמירת שינויים'), leadNote: L('Editing readiness rules requires an admin. You can review the rule read-only.', 'עריכת כללי מוכנות דורשת מנהל. ניתן לעיין בכלל לקריאה בלבד.') },
    sevLabel: { issue: L('Issue', 'תקלה'), stale: L('Stale', 'מיושן'), maint: L('Maintenance', 'תחזוקה') },
  };

  // ---------- INVENTORY ----------
  const inventory = {
    tabs: [['restock', L('Restock', 'חידושים'), ''], ['po', L('Purchase orders', 'הזמנות רכש'), ''], ['low', L('Low stock', 'מלאי נמוך'), '12']],
    newRestock: L('New restock', 'חידוש חדש'), newPo: L('New purchase order', 'הזמנת רכש חדשה'),
    rstStatus: { draft: { s: L('Draft', 'טיוטה'), st: 'unknown' }, in_progress: { s: L('In progress', 'בתהליך'), st: 'steril' }, submitted: { s: L('Submitted', 'הוגש'), st: 'maint' }, received: { s: L('Received', 'התקבל'), st: 'ok' } },
    rstCols: [L('Session', 'חידוש'), L('Status', 'סטטוס'), L('Counted', 'נספרו'), L('Started by', 'נפתח ע״י'), L('Updated', 'עודכן')],
    restock: [
      { id: 'RS-1042', loc: L('ICU crash cart', 'עגלת החייאה ICU'), status: 'in_progress', counted: '8 / 14', by: L('Roi Levi', 'רועי לוי'), upd: L('12m ago', 'לפני 12 ד׳') },
      { id: 'RS-1041', loc: L('Surgery store', 'מחסן ניתוחים'), status: 'submitted', counted: '22 / 22', by: L('Sara Adler', 'שרה אדלר'), upd: L('1h ago', 'לפני שעה') },
      { id: 'RS-1039', loc: L('Pharmacy fridge', 'מקרר בית מרקחת'), status: 'received', counted: '16 / 16', by: L('Dan Cohen', 'דן כהן'), upd: L('Yesterday', 'אתמול') },
      { id: 'RS-1038', loc: L('ICU consumables', 'מתכלים ICU'), status: 'draft', counted: '0 / 10', by: L('Maya Arad', 'מאיה ארד'), upd: L('2d ago', 'לפני יומיים') },
    ],
    poStatus: { pending: { s: L('Pending', 'ממתין'), st: 'maint' }, approved: { s: L('Approved', 'אושר'), st: 'steril' }, received: { s: L('Received', 'התקבל'), st: 'ok' } },
    poCols: [L('PO · Vendor', 'הזמנה · ספק'), L('Items', 'פריטים'), L('Total', 'סכום'), L('Status', 'סטטוס'), L('Created', 'נוצר')],
    po: [
      { id: 'PO-2207', vendor: 'Provet Supplies', items: '6', total: '₪4,820', status: 'pending', created: L('Today', 'היום') },
      { id: 'PO-2205', vendor: 'MedVet Ltd', items: '3', total: '₪1,240', status: 'approved', created: L('Yesterday', 'אתמול') },
      { id: 'PO-2201', vendor: 'Provet Supplies', items: '11', total: '₪9,610', status: 'received', created: L('3d ago', 'לפני 3 ימים') },
    ],
    lowCols: [L('Item', 'פריט'), L('Par', 'רף'), L('On hand', 'במלאי'), L('Short', 'חוסר')],
    addRestock: L('Add to restock', 'הוספה לחידוש'),
    low: [
      { name: L('Syringe 10ml', 'מזרק 10 מ״ל'), par: '200', hand: '40', short: '160' },
      { name: L('IV set', 'ערכת עירוי'), par: '80', hand: '22', short: '58' },
      { name: L('Gauze 10×10', 'גזה 10×10'), par: '300', hand: '90', short: '210' },
      { name: L('ET tube 7.0', 'טובוס 7.0'), par: '40', hand: '12', short: '28' },
      { name: L('Adrenaline 1mg', 'אדרנלין 1 מ״ג'), par: '24', hand: '6', short: '18' },
      { name: L('Suture 3-0', 'תפר 3-0'), par: '60', hand: '20', short: '40' },
    ],
    lowMore: L('and 6 more items below par', 'ועוד 6 פריטים מתחת לרף'),
    steps: [L('Location', 'מיקום'), L('Count', 'ספירה'), L('Review', 'בדיקה')],
    stepIdx: { draft: 1, in_progress: 2, submitted: 3, received: 3 },
    countItems: [
      { name: L('Syringe 10ml', 'מזרק 10 מ״ל'), par: '40', cnt: 24 },
      { name: L('IV set', 'ערכת עירוי'), par: '20', cnt: 12 },
      { name: L('Gauze 10×10', 'גזה 10×10'), par: '60', cnt: 40 },
      { name: L('Adrenaline 1mg', 'אדרנלין 1 מ״ג'), par: '12', cnt: 8 },
      { name: L('ET tube 7.0', 'טובוס 7.0'), par: '10', cnt: 6 },
    ],
    drawer: { loc: L('Location', 'מיקום'), progress: L('Progress', 'התקדמות'), by: L('Started by', 'נפתח ע״י'), upd: L('Updated', 'עודכן'), countTitle: L('Count items', 'ספירת פריטים'), vsPar: L('vs. par level', 'מול רמת הרף'), par: L('Par', 'רף'), saveDraft: L('Save draft', 'שמירת טיוטה'), leadNote: L('Counting and submitting a restock require an admin. You can review this session read-only.', 'ספירה ושליחת חידוש דורשות מנהל. ניתן לעיין בחידוש זה לקריאה בלבד.') },
    primaryStep: [L('Continue to count', 'המשך לספירה'), L('Continue to review', 'המשך לבדיקה'), L('Mark received', 'סימון כהתקבל')],
    completed: L('Completed', 'הושלם'),
  };

  // ---------- INTEGRATIONS ----------
  const integrations = {
    tabs: [['integrations', L('Integrations', 'אינטגרציות')], ['webhooks', L('Webhooks', 'Webhooks')]],
    addIntegration: L('Add integration', 'הוספת אינטגרציה'), addWebhook: L('Add webhook', 'הוספת Webhook'),
    editCred: L('Edit credential', 'עריכת פרטי גישה'), syncNow: L('Sync now', 'סנכרון עכשיו'), viewConfig: L('View config', 'צפייה בתצורה'), rotate: L('Rotate', 'החלפה'),
    fEndpoint: L('Endpoint', 'נקודת קצה'), fApiKey: L('API key', 'מפתח API'), fLastSync: L('Last sync', 'סנכרון אחרון'),
    list: [
      { vendor: 'Provet PMS', kind: L('Practice management · two-way', 'ניהול מרפאה · דו-כיווני'), endpoint: 'api.provet.cloud/v2', key: '3f9c', st: 'ok', s: L('Live', 'פעיל'), lastSync: L('4m ago', 'לפני 4 ד׳'), summary: L('1,204 records · last 24h', '1,204 רשומות · 24 שע׳') },
      { vendor: 'MedVet Labs', kind: L('Lab results · inbound', 'תוצאות מעבדה · נכנס'), endpoint: 'hooks.medvet.io/results', key: '7c21', st: 'maint', s: L('Degraded', 'מוגבל'), lastSync: L('2h ago', 'לפני שעתיים'), summary: L('Retrying · 3 pending', 'מנסה שוב · 3 ממתינות') },
    ],
    epTitle: L('Webhook endpoints', 'נקודות קצה'), logTitle: L('Delivery log', 'יומן מסירה'),
    epCols: [L('Endpoint', 'נקודת קצה'), L('Signing secret', 'סוד חתימה'), L('Events', 'אירועים'), L('State', 'מצב')],
    endpoints: [
      { url: 'hooks.rg-vet.co.il/appointments', secret: 'e81b', events: 'appointment.*', st: 'ok', s: L('Active', 'פעיל') },
      { url: 'hooks.rg-vet.co.il/equipment', secret: '44af', events: 'asset.custody, asset.readiness', st: 'ok', s: L('Active', 'פעיל') },
      { url: 'hooks.partner.io/sync', secret: '9d0c', events: 'inventory.low_stock', st: 'issue', s: L('Failing', 'נכשל') },
    ],
    logCols: [L('Event', 'אירוע'), L('Result', 'תוצאה'), L('Code', 'קוד'), L('When', 'מתי')],
    deliveries: [
      { event: 'appointment.created', st: 'ok', s: L('Delivered', 'נמסר'), code: '200', when: L('2m ago', 'לפני 2 ד׳') },
      { event: 'asset.custody', st: 'ok', s: L('Delivered', 'נמסר'), code: '200', when: L('9m ago', 'לפני 9 ד׳') },
      { event: 'inventory.low_stock', st: 'issue', s: L('Failed', 'נכשל'), code: '503', when: L('14m ago', 'לפני 14 ד׳') },
      { event: 'asset.readiness', st: 'ok', s: L('Delivered', 'נמסר'), code: '202', when: L('31m ago', 'לפני 31 ד׳') },
    ],
    drawer: { newKey: L('Replace API key', 'החלפת מפתח API'), placeholder: L('Paste a new key to rotate', 'הדביקו מפתח חדש להחלפה'), explainer: L('For security, the stored key is never shown in full — only the last 4 characters.', 'מטעמי אבטחה, המפתח השמור אינו מוצג במלואו — רק 4 התווים האחרונים.'), writeOnly: L('Write-only: entering a new key replaces the stored one. The previous key is never redisplayed.', 'כתיבה בלבד: הזנת מפתח חדש מחליפה את השמור. המפתח הקודם לעולם אינו מוצג מחדש.'), rotateBtn: L('Rotate key', 'החלפת מפתח'), cancel: L('Cancel', 'ביטול'), leadNote: L('Credentials are managed by an admin. This view is read-only and never reveals a secret.', 'פרטי הגישה מנוהלים ע״י מנהל. תצוגה זו לקריאה בלבד ולעולם אינה חושפת סוד.') },
  };

  // ---------- NOTIFICATIONS ----------
  const notifications = {
    tabs: [['channels', L('Channels', 'ערוצים')], ['templates', L('Templates', 'תבניות')], ['log', L('Delivery log', 'יומן מסירה')]],
    newTemplate: L('New template', 'תבנית חדשה'),
    credential: L('Credential', 'פרטי גישה'), last24: L('Last 24h', '24 שע׳ אחרונות'), configure: L('Configure', 'הגדרה'), sendTest: L('Send test', 'שליחת בדיקה'),
    channels: [
      { icon: 'chat', name: L('WhatsApp Business', 'WhatsApp Business'), provider: 'WhatsApp Cloud API', cred: '3f21', st: 'issue', s: L('Degraded', 'מוגבל'), summary: L('4 failed · 128 sent', '4 נכשלו · 128 נשלחו') },
      { icon: 'bell', name: L('Push notifications', 'התראות Push'), provider: 'APNs · FCM', cred: '9b2a', st: 'ok', s: L('Live', 'פעיל'), summary: L('1,022 sent', '1,022 נשלחו') },
    ],
    tmCols: [L('Template', 'תבנית'), L('Channel', 'ערוץ'), L('Audience', 'קהל'), L('Status', 'סטטוס')],
    chLabel: { whatsapp: L('WhatsApp', 'WhatsApp'), push: L('Push', 'Push') },
    templates: [
      { name: L('Appointment reminder', 'תזכורת תור'), channel: 'whatsapp', audience: L('Clients with appointments', 'לקוחות עם תורים'), status: 'active', trigger: 'appointment.upcoming', body: L('Hi {{client}}, reminder: {{pet}} has an appointment on {{date}} at {{time}}.', 'שלום {{client}}, תזכורת: ל{{pet}} יש תור בתאריך {{date}} בשעה {{time}}.') },
      { name: L('Restock needed', 'נדרש חידוש'), channel: 'push', audience: L('Inventory leads', 'אחראי מלאי'), status: 'active', trigger: 'inventory.low_stock', body: L('{{count}} items are below par level in {{location}}. Open a restock session.', '{{count}} פריטים מתחת לרף ב{{location}}. פתחו חידוש מלאי.') },
      { name: L('Equipment overdue', 'ציוד באיחור'), channel: 'push', audience: L('Equipment leads', 'אחראי ציוד'), status: 'active', trigger: 'asset.readiness_overdue', body: L('{{asset}} missed its readiness check in {{room}}.', '{{asset}} פספס בדיקת מוכנות ב{{room}}.') },
      { name: L('Shift handoff', 'חילוף משמרת'), channel: 'whatsapp', audience: L('On-shift staff', 'צוות במשמרת'), status: 'paused', trigger: 'shift.handoff', body: L('Handoff at {{time}}: {{count}} open items to review.', 'חילוף בשעה {{time}}: {{count}} פריטים פתוחים לבדיקה.') },
    ],
    tmStatus: { active: { s: L('Active', 'פעיל'), st: 'ok' }, paused: { s: L('Paused', 'מושהה'), st: 'unknown' } },
    logCols: [L('Recipient', 'נמען'), L('Channel', 'ערוץ'), L('Result', 'תוצאה'), L('When', 'מתי')],
    deliveries: [
      { recipient: '+972 ••• ••• 4821', channel: 'whatsapp', st: 'issue', s: L('Failed', 'נכשל'), when: L('14m ago', 'לפני 14 ד׳') },
      { recipient: 'device •••• a91c', channel: 'push', st: 'ok', s: L('Delivered', 'נמסר'), when: L('20m ago', 'לפני 20 ד׳') },
      { recipient: '+972 ••• ••• 1180', channel: 'whatsapp', st: 'ok', s: L('Delivered', 'נמסר'), when: L('33m ago', 'לפני 33 ד׳') },
      { recipient: 'device •••• 77de', channel: 'push', st: 'ok', s: L('Delivered', 'נמסר'), when: L('41m ago', 'לפני 41 ד׳') },
    ],
    drawer: { kind: L('Message template', 'תבנית הודעה'), channel: L('Channel', 'ערוץ'), trigger: L('Trigger', 'טריגר'), audience: L('Audience', 'קהל'), status: L('Status', 'סטטוס'), preview: L('Message preview', 'תצוגת הודעה'), phNote: L('{{ placeholders }} are filled per recipient at send time.', 'ה-{{ placeholders }} מתמלאים לכל נמען בעת השליחה.'), edit: L('Edit template', 'עריכת תבנית'), leadNote: L('Editing and sending require an admin. You can review the template read-only.', 'עריכה ושליחה דורשות מנהל. ניתן לעיין בתבנית לקריאה בלבד.') },
  };

  // ---------- RFID ----------
  const rfid = {
    register: L('Register reader', 'רישום קורא'),
    online: L('online', 'מקוונים'), degraded: L('degraded', 'מוגבלים'), offline: L('offline', 'לא מקוונים'),
    cols: [L('Reader', 'קורא'), L('Location', 'מיקום'), L('Status', 'סטטוס'), L('Last heartbeat', 'פעימה אחרונה'), L('Firmware', 'קושחה')],
    rdStatus: { online: { s: L('Online', 'מקוון'), st: 'ok' }, degraded: { s: L('Degraded', 'מוגבל'), st: 'maint' }, offline: { s: L('Offline', 'לא מקוון'), st: 'issue' } },
    readers: [
      { name: 'ICU-Dock-1', loc: L('ICU', 'טיפול נמרץ'), status: 'online', hb: L('8s ago', 'לפני 8 שנ׳'), fw: 'v2.4.1', dock: 'ICU-Dock', captures: '312', uptime: '99.9%' },
      { name: 'ICU-Dock-2', loc: L('ICU', 'טיפול נמרץ'), status: 'online', hb: L('12s ago', 'לפני 12 שנ׳'), fw: 'v2.4.1', dock: 'ICU-Dock', captures: '288', uptime: '99.8%' },
      { name: 'Surgery-Dock', loc: L('Surgery', 'חדר ניתוח'), status: 'online', hb: L('5s ago', 'לפני 5 שנ׳'), fw: 'v2.4.1', dock: 'Surgery-Dock', captures: '156', uptime: '99.9%' },
      { name: 'Pharmacy-Dock', loc: L('Pharmacy', 'בית מרקחת'), status: 'online', hb: L('22s ago', 'לפני 22 שנ׳'), fw: 'v2.4.1', dock: 'Pharmacy-Dock', captures: '74', uptime: '99.7%' },
      { name: 'Store-Dock', loc: L('Storage', 'מחסן'), status: 'online', hb: L('45s ago', 'לפני 45 שנ׳'), fw: 'v2.4.0', dock: 'Store-Dock', captures: '41', uptime: '99.5%' },
      { name: 'Recovery-Dock', loc: L('Recovery', 'התאוששות'), status: 'degraded', hb: L('3m ago', 'לפני 3 ד׳'), fw: 'v2.3.9', dock: 'Recovery-Dock', captures: '62', uptime: '97.2%' },
      { name: 'ICU-Dock-3', loc: L('ICU', 'טיפול נמרץ'), status: 'offline', hb: L('12m ago', 'לפני 12 ד׳'), fw: 'v2.4.1', dock: 'ICU-Dock', captures: '0', uptime: '96.1%' },
    ],
    drawer: { status: L('Status', 'סטטוס'), hb: L('Last heartbeat', 'פעימה אחרונה'), fw: L('Firmware', 'קושחה'), dock: L('Paired dock', 'עגינה משויכת'), captures: L('Captures today', 'לכידות היום'), uptime: L('Uptime · 30d', 'זמינות · 30 ימים'), offlineNote: L('Custody auto-capture at this reader is paused until it reconnects.', 'לכידת החזקה אוטומטית בקורא זה מושהית עד לחיבור מחדש.'), restart: L('Restart', 'הפעלה מחדש'), rename: L('Rename', 'שינוי שם'), unpair: L('Unpair', 'ביטול שיוך'), leadNote: L('Reader actions require an admin. You can review device health read-only.', 'פעולות על קוראים דורשות מנהל. ניתן לעיין בתקינות המכשיר לקריאה בלבד.') },
  };

  // ---------- OPS HEALTH ----------
  const ops = {
    frozenBanner: L('Read-only dashboards over frozen telemetry — the console observes; it never requeues, purges, or changes transport.', 'לוחות מחוונים לקריאה בלבד מעל טלמטריה קפואה — הקונסולה צופה; אינה מריצה מחדש, מנקה או משנה תעבורה.'),
    metricsTitle: L('Operational metrics', 'מדדים תפעוליים'), metricsWindow: L('last 60 min', '60 הדק׳ האחרונות'),
    kpis: [{ v: '42', l: L('events / min', 'אירועים / דק׳') }, { v: '180ms', l: L('p95 latency', 'זמן תגובה p95') }, { v: '0.6%', l: L('error rate', 'שיעור שגיאות'), ok: true }],
    bars: [40, 52, 46, 60, 55, 68, 50, 64, 58, 72, 62, 57],
    chartNote: L('CSS-illustrative — the shipped build renders recharts over the same aggregates.', 'המחשה ב-CSS — הגרסה המיוצרת מרנדרת recharts מעל אותם צברים.'),
    dlqTitle: L('Outbox DLQ', 'תור נכשלים DLQ'), dlqCount: '2',
    dlq: [
      { event: 'notification.whatsapp_send', attempts: L('5 attempts', '5 ניסיונות'), age: L('33m', '33 ד׳') },
      { event: 'webhook.inventory_low', attempts: L('3 attempts', '3 ניסיונות'), age: L('14m', '14 ד׳') },
    ],
    dlqNote: L('Read-only. Replay / drain happens in the ops runbook, not the console.', 'לקריאה בלבד. הרצה מחדש מתבצעת ב-runbook התפעולי, לא בקונסולה.'),
    queueTitle: L('Sync queue', 'תור סנכרון'), queueHealthy: L('Healthy', 'תקין'), queueDepth: '3', queueDepthL: L('in queue', 'בתור'),
    queueOldestL: L('Oldest', 'הישן ביותר'), queueOldest: L('2m', '2 ד׳'), queueTputL: L('Throughput', 'תפוקה'), queueTput: L('58 / min', '58 / דק׳'),
    healthTitle: L('Outbox health', 'תקינות Outbox'), healthPct: '99.4%', healthPctL: L('delivered', 'נמסרו'), healthDelL: L('Last 24h', '24 שע׳'), healthDel: L('8,912 events', '8,912 אירועים'),
    displayTitle: L('Display heartbeats', 'פעימות תצוגה'), displaySummary: L('4 of 4 live', '4 מתוך 4 פעילים'),
    displays: [
      { name: L('ICU wall', 'קיר ICU'), beat: L('3s ago', 'לפני 3 שנ׳') },
      { name: L('Surgery wall', 'קיר ניתוחים'), beat: L('6s ago', 'לפני 6 שנ׳') },
      { name: L('Reception', 'קבלה'), beat: L('9s ago', 'לפני 9 שנ׳') },
      { name: L('Recovery', 'התאוששות'), beat: L('12s ago', 'לפני 12 שנ׳') },
    ],
    displayNote: L('Heartbeats only — these tiles seed the future Displays console (Phase 9).', 'פעימות בלבד — אריחים אלה מהווים בסיס לקונסולת התצוגות העתידית (שלב 9).'),
  };

  // ---------- ANALYTICS ----------
  const analytics = {
    ranges: ['7d', '30d', '90d'], exportLabel: L('Export', 'ייצוא'), schedule: L('Schedule report', 'תזמון דוח'), download: L('Download', 'הורדה'),
    kpis: [
      { l: L('Assets tracked', 'נכסים במעקב'), v: '214', delta: '+6', up: true },
      { l: L('Avg readiness', 'זמן מוכנות ממוצע'), v: '3.2h', delta: '−0.4h', up: true },
      { l: L('Utilization', 'ניצולת'), v: '78%', delta: '+3%', up: true },
      { l: L('On-time rate', 'שיעור בזמן'), v: '94%', delta: '−1%', up: false },
    ],
    trendTitle: L('Readiness trend', 'מגמת מוכנות'), trendSub: L('% ready / day', '% מוכן / יום'),
    trend: [[L('Sun', 'א'), 82], [L('Mon', 'ב'), 85], [L('Tue', 'ג'), 81], [L('Wed', 'ד'), 88], [L('Thu', 'ה'), 86], [L('Fri', 'ו'), 90], [L('Sat', 'ש'), 87]],
    chartNote: L('CSS-illustrative — the shipped build renders recharts over the same aggregates.', 'המחשה ב-CSS — הגרסה המיוצרת מרנדרת recharts מעל אותם צברים.'),
    outcomeTitle: L('Outcome mix', 'תמהיל מצב'),
    outcome: [
      { label: L('Ready', 'מוכן'), pct: '87%', color: 'rgb(52 199 89)' },
      { label: L('Maintenance', 'תחזוקה'), pct: '6%', color: 'rgb(255 149 0)' },
      { label: L('Stale', 'מיושן'), pct: '4%', color: 'rgb(175 82 222)' },
      { label: L('Issue', 'תקלה'), pct: '3%', color: 'rgb(255 59 48)' },
    ],
    roomTitle: L('Utilization by room', 'ניצולת לפי חדר'),
    rooms: [
      { name: L('ICU', 'טיפול נמרץ'), pct: '88%' }, { name: L('Surgery', 'ניתוח'), pct: '72%' },
      { name: L('Recovery', 'התאוששות'), pct: '64%' }, { name: L('Pharmacy', 'מרקחת'), pct: '45%' }, { name: L('Storage', 'מחסן'), pct: '30%' },
    ],
    leaderTitle: L('Shift leaderboard', 'מובילי משמרת'), leaderSub: L('scans', 'סריקות'),
    leaders: [
      { name: L('R. Levi', 'ר. לוי'), scans: 142 }, { name: L('S. Adler', 'ש. אדלר'), scans: 118 },
      { name: L('D. Cohen', 'ד. כהן'), scans: 96 }, { name: L('N. Bar', 'נ. בר'), scans: 74 },
    ],
    reportsTitle: L('Saved reports', 'דוחות שמורים'),
    reportCols: [L('Report', 'דוח'), L('Range', 'טווח'), L('Format', 'פורמט'), L('Last run', 'הרצה אחרונה')],
    reports: [
      { name: L('Weekly readiness summary', 'סיכום מוכנות שבועי'), range: '7d', format: 'PDF', lastRun: L('Yesterday', 'אתמול') },
      { name: L('Shift leaderboard', 'מובילי משמרת'), range: '30d', format: 'CSV', lastRun: L('3d ago', 'לפני 3 ימים') },
      { name: L('Outcome KPI', 'מדדי מצב'), range: '90d', format: 'CSV', lastRun: L('1w ago', 'לפני שבוע') },
    ],
  };

  // ---------- AUDIT ----------
  const audit = {
    appendOnly: L('Append-only', 'הוספה בלבד'),
    filters: [['all', L('All', 'הכל')], ['create', L('Created', 'נוצר')], ['update', L('Updated', 'עודכן')], ['delete', L('Deleted', 'נמחק')], ['auth', L('Auth', 'אימות')]],
    filterLabel: L('Filter', 'סינון'),
    cols: [L('When', 'מתי'), L('Actor', 'מבצע'), L('Action', 'פעולה'), L('Target', 'יעד')],
    kindMeta: { create: { st: 'ok' }, update: { st: 'steril' }, delete: { st: 'issue' }, auth: { st: 'maint' } },
    kindLabel: { create: L('Created', 'נוצר'), update: L('Updated', 'עודכן'), delete: L('Deleted', 'נמחק'), auth: L('Auth', 'אימות') },
    entries: [
      { when: '09:42:11', actor: L('M. Arad', 'מ. ארד'), ini: 'MA', system: false, role: L('Administrator', 'מנהל/ת מערכת'), kind: 'update', action: 'role.updated', target: 'user:dan.cohen', ip: '10.0.4.21', diff: [{ k: 'role', from: 'student', to: 'technician' }] },
      { when: '09:38:02', actor: L('System', 'מערכת'), ini: '', system: true, role: L('Service', 'שירות'), kind: 'update', action: 'webhook.secret_rotated', target: 'integration:provet', ip: 'internal', diff: [{ k: 'secret', from: 'whsec_••••', to: 'whsec_••••' }] },
      { when: '09:20:55', actor: L('R. Levi', 'ר. לוי'), ini: 'RL', system: false, role: L('Senior technician', 'טכנאי בכיר'), kind: 'create', action: 'restock.session_opened', target: 'restock:RS-1042', ip: '10.0.4.18', diff: [{ k: 'location', from: '—', to: 'ICU cart' }] },
      { when: '08:55:30', actor: L('M. Arad', 'מ. ארד'), ini: 'MA', system: false, role: L('Administrator', 'מנהל/ת מערכת'), kind: 'create', action: 'rule.created', target: 'rule:ready-12h', ip: '10.0.4.21', diff: [{ k: 'window', from: '—', to: '12h' }] },
      { when: '08:40:12', actor: L('N. Bar', 'נ. בר'), ini: 'NB', system: false, role: L('Vet', 'וטרינר'), kind: 'auth', action: 'auth.signed_in', target: 'session:9f3a', ip: '10.0.4.30', diff: [] },
      { when: '08:12:07', actor: L('M. Arad', 'מ. ארד'), ini: 'MA', system: false, role: L('Administrator', 'מנהל/ת מערכת'), kind: 'delete', action: 'assetType.deleted', target: 'assetType:old-monitor', ip: '10.0.4.21', diff: [{ k: 'status', from: 'active', to: 'removed' }] },
      { when: '07:58:44', actor: L('System', 'מערכת'), ini: '', system: true, role: L('Service', 'שירות'), kind: 'update', action: 'reader.status_changed', target: 'reader:icu-dock-3', ip: 'internal', diff: [{ k: 'status', from: 'online', to: 'offline' }] },
      { when: '07:41:19', actor: L('S. Adler', 'ש. אדלר'), ini: 'SA', system: false, role: L('Technician', 'טכנאי'), kind: 'auth', action: 'auth.signed_in', target: 'session:2b7c', ip: '10.0.4.27', diff: [] },
    ],
    drawer: { actor: L('Actor', 'מבצע'), role: L('Actor role', 'תפקיד מבצע'), when: L('When', 'מתי'), ip: L('Source', 'מקור'), target: L('Target', 'יעד'), kind: L('Action type', 'סוג פעולה'), diff: L('Change', 'שינוי'), exportEntry: L('Export entry', 'ייצוא רשומה'), note: L('This entry is immutable. Corrections are recorded as new append-only events.', 'רשומה זו אינה ניתנת לשינוי. תיקונים נרשמים כאירועים חדשים בהוספה בלבד.') },
    footNote: L('Append-only log · entries are never edited or removed', 'יומן בהוספה בלבד · רשומות אינן נערכות או נמחקות'),
  };

  return { clinic, personas, nav, crumb, title, t, home, people, equipment, inventory, integrations, notifications, rfid, ops, analytics, audit };
})();
