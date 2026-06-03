// EquipmentDetailScreen — full record for one item. Opens from an Equipment row.
// Status hero (tone-colored) → key actions → spec details → location → history.
// Tokenized, DM Mono numerics.
const ED_NUM = { fontFamily: "var(--font-num)" };

function EquipmentDetailScreen({ dir = "ltr", item, onBack, onScan }) {
  const isRtl = dir === "rtl";
  const eq = item || {
    id: "DEF-0492", name: isRtl ? "דפיברילטור" : "Defibrillator", type: isRtl ? "החייאה" : "Resuscitation",
    loc: "OR 3", status: "err", statusLabel: isRtl ? "בדיקה באיחור" : "Check overdue",
    serial: "DEF-0492-2021-117", since: isRtl ? "לפני 9 ימים" : "9 days ago",
  };

  const heroTone = {
    err:  { a: "#3a1414", b: "#5a1d1d", chip: "var(--status-issue)" },
    warn: { a: "#3a2a0e", b: "#5a4215", chip: "var(--status-maintenance)" },
    use:  { a: "var(--hero-a)", b: "var(--hero-b)", chip: "var(--brand)" },
    ok:   { a: "var(--hero-a)", b: "var(--hero-b)", chip: "var(--action)" },
  }[eq.status] || { a: "var(--hero-a)", b: "var(--hero-b)", chip: "var(--action)" };

  const actions = eq.status === "err"
    ? [{ icon: "check", label: isRtl ? "תעד בדיקה" : "Log check", primary: true }, { icon: "wrench", label: isRtl ? "שלח לתחזוקה" : "Send to maintenance", primary: false }]
    : eq.status === "warn"
    ? [{ icon: "wrench", label: isRtl ? "התחל תחזוקה" : "Start maintenance", primary: true }, { icon: "check", label: isRtl ? "סמן כתקין" : "Mark operational", primary: false }]
    : eq.status === "use"
    ? [{ icon: "logOut", label: isRtl ? "החזר" : "Return", primary: true }, { icon: "mapPin", label: isRtl ? "אתר" : "Locate", primary: false }]
    : [{ icon: "logIn", label: isRtl ? "קח לשימוש" : "Check out", primary: true }, { icon: "scanLine", label: isRtl ? "סרוק" : "Scan", primary: false }];

  const specs = [
    { k: isRtl ? "סוג" : "Type", v: eq.type, tone: "" },
    { k: isRtl ? "מספר סידורי" : "Serial", v: eq.serial, tone: "mono" },
    { k: isRtl ? "סטטוס" : "Status", v: eq.statusLabel, tone: eq.status === "err" ? "err" : eq.status === "warn" ? "warn" : "ok" },
    { k: isRtl ? "מיקום" : "Location", v: eq.loc, tone: "" },
    { k: isRtl ? "בסטטוס מאז" : "In status since", v: eq.since, tone: eq.status === "err" ? "err" : "" },
  ];
  const history = [
    { title: isRtl ? "סריקת NFC" : "NFC scan", who: "Maya", time: isRtl ? "לפני 2ש'" : "2h ago", done: true },
    { title: isRtl ? "בדיקה שגרתית" : "Routine check", who: "Lior", time: isRtl ? "לפני 9 ימים" : "9d ago", done: true },
    { title: isRtl ? "עיקור הושלם" : "Sterilization completed", who: "Daniel", time: isRtl ? "לפני 11 יום" : "11d ago", done: true },
  ];

  const label = (txt) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--ivory-text-3)", padding: "0 4px", margin: "16px 0 8px" }}>{txt}</div>
  );
  const card = { background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 14, padding: 16, marginBottom: 8 };

  return (
    <div dir={dir} style={{ background: "var(--background)", minHeight: "100%" }}>
      <style>{`@keyframes edUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } } .ed-up { animation: edUp 0.32s ease both; }`}</style>

      <div style={{ padding: "8px 18px 80px" }}>
        {/* Back row */}
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: 0,
          color: "var(--ivory-text-2)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500,
          cursor: "pointer", padding: "6px 4px", marginBottom: 6,
        }}>
          <Icon name={isRtl ? "chevronRight" : "chevronLeft"} size={16} /> {isRtl ? "ציוד" : "Equipment"}
        </button>

        {/* Status hero */}
        <div className="ed-up" style={{
          position: "relative", overflow: "hidden", borderRadius: 18, padding: 18, marginBottom: 14,
          background: `linear-gradient(155deg, ${heroTone.a} 0%, ${heroTone.b} 100%)`, color: "#fff",
          boxShadow: "0 16px 32px -18px rgba(0,0,0,0.4)",
        }}>
          <div aria-hidden="true" style={{ position: "absolute", top: -30, insetInlineEnd: -30, width: 130, height: 130, background: `radial-gradient(circle, ${heroTone.chip} 0%, transparent 70%)`, opacity: 0.3 }} />
          <div style={{ position: "relative" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", borderRadius: 100, padding: "4px 10px", marginBottom: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: heroTone.chip }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>{eq.statusLabel}</span>
            </span>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.15, marginBottom: 4 }}>{eq.name}</div>
            <div style={{ ...ED_NUM, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{eq.id} · {eq.loc}</div>
          </div>
        </div>

        {/* Actions */}
        {label(isRtl ? "פעולות" : "Actions")}
        <div className="ed-up" style={{ display: "flex", gap: 8 }}>
          {actions.map((a, i) => (
            <button key={i} onClick={a.icon === "scanLine" ? onScan : undefined} style={{
              flex: 1, height: 48, borderRadius: 12, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              border: a.primary ? 0 : "1px solid var(--ivory-border)",
              background: a.primary ? "var(--brand)" : "var(--ivory-surface)",
              color: a.primary ? "#fff" : "var(--ivory-text)",
            }}><Icon name={a.icon} size={16} /> {a.label}</button>
          ))}
        </div>

        {/* Specs */}
        {label(isRtl ? "מפרט" : "Specs")}
        <div className="ed-up" style={card}>
          {specs.map((d, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: i === 0 ? "0 0 9px" : i === specs.length - 1 ? "9px 0 0" : "9px 0",
              borderBottom: i === specs.length - 1 ? "none" : "1px solid var(--ivory-border)",
            }}>
              <span style={{ fontSize: 13, color: "var(--ivory-text-3)" }}>{d.k}</span>
              <span style={{
                fontSize: d.tone === "mono" ? 12 : 13, fontWeight: 500, textAlign: isRtl ? "left" : "right",
                fontFamily: d.tone === "mono" ? "var(--font-num)" : "var(--font-sans)",
                color: d.tone === "err" ? "var(--status-issue)" : d.tone === "warn" ? "var(--status-maintenance)" : d.tone === "ok" ? "var(--action-ink)" : "var(--ivory-text)",
              }}>{d.v}</span>
            </div>
          ))}
        </div>

        {/* History */}
        {label(isRtl ? "היסטוריה" : "History")}
        <div className="ed-up" style={card}>
          {history.map((h, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
              borderBottom: i === history.length - 1 ? "none" : "1px solid var(--ivory-border)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--action)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ivory-text)" }}>{h.title}</div>
                <div style={{ fontSize: 11, color: "var(--ivory-text-3)", marginTop: 1 }}>{h.who}</div>
              </div>
              <span style={{ ...ED_NUM, fontSize: 10, color: "var(--ivory-text-3)", flexShrink: 0 }}>{h.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.EquipmentDetailScreen = EquipmentDetailScreen;
