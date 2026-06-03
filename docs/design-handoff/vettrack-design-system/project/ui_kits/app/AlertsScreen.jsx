// AlertsScreen — third tab in the polished prototype.
function AlertsScreen({ dir = "ltr" }) {
  const isRtl = dir === "rtl";
  const groups = [
    {
      title: isRtl ? "דורש פעולה" : "Action required",
      tone: "err",
      items: [
        { name: isRtl ? "עגלת חירום C-2" : "Crash Cart C-2",        room: isRtl ? "חירום" : "ER",   detail: isRtl ? "אדרנלין — 0 ביחידה" : "Epinephrine — 0 left",  time: "5m" },
        { name: isRtl ? "דפיברילטור EQ-0492" : "Defibrillator EQ-0492", room: "OR 3",  detail: isRtl ? "בדיקה אחרונה לפני 9 ימים" : "Last check 9 days ago", time: "1h" },
      ],
    },
    {
      title: isRtl ? "בתחזוקה" : "In maintenance",
      tone: "warn",
      items: [
        { name: isRtl ? "תחנת הרדמה" : "Anesthesia Workstation", room: "OR 3", detail: isRtl ? "מתוזמן · 4 במאי" : "Scheduled · 4 May", time: "—" },
        { name: isRtl ? "משאבת מזרק SP-201" : "Syringe Pump SP-201", room: "ICU 2", detail: isRtl ? "באיחור של יומיים" : "Overdue 2 days", time: "2d" },
      ],
    },
  ];
  const tone = (k) => (k === "err" ? "#dc2626" : k === "warn" ? "#d97706" : "#16a34a");
  const toneBg = (k) => (k === "err" ? "#fff1f1" : k === "warn" ? "#fffbeb" : "#f0faf2");

  return (
    <div dir={dir} style={{ padding: "14px 14px 96px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.015em" }}>{isRtl ? "התראות" : "Alerts"}</h1>
      {groups.map((g, gi) => (
        <div key={gi}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: tone(g.tone) }} />
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{g.title}</p>
            <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1" }}>{g.items.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.items.map((it, i) => (
              <div key={i} style={{
                background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
                borderRadius: 14, padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
                borderInlineStartWidth: 3, borderInlineStartStyle: "solid", borderInlineStartColor: tone(g.tone),
              }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 12,
                  background: toneBg(g.tone), color: tone(g.tone),
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}><Icon name={g.tone === "err" ? "alert" : "wrench"} size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ivory-text-3)" }}>{it.room} · {it.detail}</p>
                </div>
                <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", fontWeight: 600, whiteSpace: "nowrap" }}>{it.time}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
window.AlertsScreen = AlertsScreen;
