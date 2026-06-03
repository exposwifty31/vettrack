// Alerts — magnetic. "All clear" celebration when zero, otherwise grouped by severity
// with one big "Handle the worst one" CTA in the thumb zone.
function AlertsScreenMagnetic({ dir = "ltr" }) {
  const isRtl = dir === "rtl";
  const groups = [
    {
      tone: "err",
      title: isRtl ? "דחוף" : "Urgent",
      items: [
        { name: isRtl ? "עגלת חירום C-2" : "Crash Cart C-2",          room: isRtl ? "חירום" : "ER", detail: isRtl ? "אדרנלין — 0 ביחידה" : "Epinephrine — 0 left",   time: "5m" },
        { name: isRtl ? "דפיברילטור EQ-0492" : "Defibrillator EQ-0492", room: "OR 3", detail: isRtl ? "בדיקה לפני 9 ימים" : "Last check 9 days ago", time: "1h" },
      ],
    },
    {
      tone: "warn",
      title: isRtl ? "תחזוקה" : "Maintenance",
      items: [
        { name: isRtl ? "תחנת הרדמה" : "Anesthesia Workstation",       room: "OR 3", detail: isRtl ? "מתוזמן · 4 במאי" : "Scheduled · 4 May", time: "—"  },
        { name: isRtl ? "משאבת מזרק SP-201" : "Syringe Pump SP-201",   room: "ICU 2", detail: isRtl ? "באיחור 2 ימים" : "Overdue 2 days",    time: "2d" },
      ],
    },
  ];
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const worst = groups[0].items[0];
  const tones = {
    err:  { dot: "#dc2626", bg: "#fef2f2", fg: "#7c2d12", iconBg: "#fee2e2", border: "#fecaca" },
    warn: { dot: "#d97706", bg: "#fdf6e7", fg: "#78350f", iconBg: "#fef3c7", border: "#f0dba8" },
  };

  return (
    <div dir={dir} style={{
      padding: "8px 14px 110px",
      background: "var(--background)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <style>{`
        @keyframes alertFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes alertPulse { 0%, 100% { transform: scale(1); opacity: 0.55; } 50% { transform: scale(1.18); opacity: 0; } }
        .al-fade { animation: alertFade 600ms cubic-bezier(0.2,0.8,0.2,1) both; }
      `}</style>

      {/* Header */}
      <div className="al-fade" style={{ paddingTop: 6 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.025em" }}>{isRtl ? "התראות" : "Alerts"}</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ivory-text-3)" }}>
          {isRtl ? `${total} פתוחות · 1 דחופה` : `${total} open · 1 urgent`}
        </p>
      </div>

      {/* Worst-first hero card — thumb zone CTA */}
      <div className="al-fade" style={{
        position: "relative", overflow: "hidden",
        borderRadius: 20, padding: "16px 16px 14px",
        background: "linear-gradient(155deg, #fef2f2 0%, #fee2e2 100%)",
        border: "1px solid #fecaca",
        boxShadow: "0 1px 2px rgb(15 23 42 / 0.04), 0 14px 26px -16px rgba(220,38,38,0.25)",
      }}>
        <div aria-hidden="true" style={{ position: "absolute", insetInlineEnd: -30, top: -30, width: 110, height: 110, background: "radial-gradient(circle, rgba(220,38,38,0.18), transparent 70%)" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7c2d12" }}>
              <span style={{ position: "relative", width: 8, height: 8 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "#dc2626" }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "#dc2626", animation: "alertPulse 2s ease-out infinite" }} />
              </span>
              {isRtl ? "הכי דחוף" : "Worst first"}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7c2d12", fontFeatureSettings: "'tnum' 1" }}>{worst.time}</span>
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#7c2d12", letterSpacing: "-0.015em" }}>{worst.name}</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#7c2d12", opacity: 0.85 }}>{worst.detail} · {worst.room}</p>
          <button style={{
            width: "100%", height: 56, borderRadius: 16, border: 0,
            background: "#7c2d12", color: "#fff", fontSize: 14.5, fontWeight: 700, fontFamily: "var(--font-sans)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
            boxShadow: "0 10px 22px -10px rgba(124,45,18,0.55)",
          }}>
            {isRtl ? "טפל עכשיו" : "Handle now"}
            <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={18} />
          </button>
        </div>
      </div>

      {/* Groups */}
      {groups.map((g, gi) => (
        <div key={gi} className="al-fade">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: tones[g.tone].dot }} />
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{g.title}</p>
            <span style={{ fontSize: 10.5, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1" }}>{g.items.length}</span>
          </div>
          <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 14, overflow: "hidden" }}>
            {g.items.map((it, i) => (
              <div key={i} style={{
                padding: "12px 14px",
                borderBottom: i === g.items.length - 1 ? "none" : "1px solid hsl(40 12% 81% / 0.5)",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 12,
                  background: tones[g.tone].iconBg, color: tones[g.tone].dot,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}><Icon name={g.tone === "err" ? "alert" : "wrench"} size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{it.room} · {it.detail}</p>
                </div>
                <span style={{ fontSize: 10.5, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", fontWeight: 600, flexShrink: 0 }}>{it.time}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
window.AlertsScreenMagnetic = AlertsScreenMagnetic;
