// AlertsScreenPro — same language as EquipmentScreenPro. Worst-first hero in the
// thumb zone, then triage sections (Urgent → Maintenance) with 3px edge-bars,
// DM Mono numerics, status pills, tappable rows. Tokenized; red stays semantic.
const AL_NUM = { fontFamily: "var(--font-num)" };

function AlertsScreenPro({ dir = "ltr", onOpen }) {
  const isRtl = dir === "rtl";

  const groups = [
    {
      key: "err", tone: "err",
      title: isRtl ? "דחוף" : "Urgent",
      items: [
        { id: "CART-C2",  name: isRtl ? "עגלת חירום C-2" : "Crash Cart C-2",      room: "ER",    detail: isRtl ? "אדרנלין — 0 ביחידה" : "Epinephrine — 0 left", pill: isRtl ? "חוסר מלאי" : "Stock out", time: "5m", status: "err" },
        { id: "DEF-0492", name: isRtl ? "דפיברילטור" : "Defibrillator",           room: "OR 3",  detail: isRtl ? "בדיקה לפני 9 ימים" : "Check 9 days ago",      pill: isRtl ? "באיחור" : "Overdue",   time: "1h", status: "err" },
      ],
    },
    {
      key: "warn", tone: "warn",
      title: isRtl ? "תחזוקה" : "Maintenance",
      items: [
        { id: "SP-201",  name: isRtl ? "משאבת מזרק" : "Syringe Pump",            room: "ICU 2", detail: isRtl ? "כיול באיחור 2 ימים" : "Cal. overdue 2 days", pill: isRtl ? "כיול" : "Cal. due",   time: "2d", status: "warn" },
        { id: "ANES-01", name: isRtl ? "תחנת הרדמה" : "Anesthesia Station",      room: "OR 3",  detail: isRtl ? "מתוזמן · 4 ביוני" : "Scheduled · 4 Jun",     pill: isRtl ? "מתוזמן" : "Scheduled", time: "—",  status: "warn" },
      ],
    },
  ];
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const urgent = groups[0].items.length;
  const worst = groups[0].items[0];

  const barColor = { err: "var(--status-issue)", warn: "var(--status-maintenance)" };
  const pillStyle = {
    err:  { background: "var(--status-issue-bg)", color: "var(--status-issue-fg)" },
    warn: { background: "var(--status-maint-bg)", color: "var(--status-maint-fg)" },
  };

  return (
    <div dir={dir} style={{ background: "var(--background)", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes alPulse { 0%,100% { transform: scale(1); opacity: 0.55; } 50% { transform: scale(1.18); opacity: 0; } }
        .alp-row { transition: background 0.1s; } .alp-row:active { background: var(--ivory-bg); }
        .alp-sec { position: sticky; top: 0; z-index: 5; background: var(--background); }
      `}</style>

      {/* Header */}
      <div style={{ padding: "10px 18px 12px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.02em" }}>{isRtl ? "התראות" : "Alerts"}</h1>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--ivory-text-3)" }}>
          <span style={{ ...AL_NUM }}>{total}</span> {isRtl ? "פתוחות" : "open"} · <span style={{ ...AL_NUM, color: "var(--status-issue)" }}>{urgent}</span> {isRtl ? "דחופות" : "urgent"}
        </p>
      </div>

      {/* Worst-first hero — thumb zone CTA */}
      <div style={{ padding: "0 18px 4px" }}>
        <div style={{
          position: "relative", overflow: "hidden",
          borderRadius: 16, padding: "14px 16px 14px",
          background: "var(--status-issue-bg)", border: "1px solid var(--status-issue-border)",
        }}>
          <div aria-hidden="true" style={{ position: "absolute", insetInlineEnd: -30, top: -30, width: 110, height: 110, background: "radial-gradient(circle, rgba(220,38,38,0.14), transparent 70%)" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--status-issue-fg)" }}>
                <span style={{ position: "relative", width: 7, height: 7 }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--status-issue)" }} />
                  <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--status-issue)", animation: "alPulse 2s ease-out infinite" }} />
                </span>
                {isRtl ? "הכי דחוף" : "Worst first"}
              </span>
              <span style={{ ...AL_NUM, fontSize: 10.5, fontWeight: 500, color: "var(--status-issue-fg)" }}>{worst.time}</span>
            </div>
            <h2 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 700, color: "var(--status-issue-fg)", letterSpacing: "-0.015em" }}>{worst.name}</h2>
            <p style={{ margin: "0 0 13px", fontSize: 12.5, color: "var(--status-issue-fg)", opacity: 0.85 }}>{worst.detail} · {worst.room}</p>
            <button onClick={() => onOpen && onOpen(worst)} style={{
              width: "100%", height: 50, borderRadius: 13, border: 0,
              background: "var(--status-issue-fg)", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {isRtl ? "טפל עכשיו" : "Handle now"}
              <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={17} />
            </button>
          </div>
        </div>
      </div>

      {/* Triage sections */}
      <div style={{ flex: 1, paddingBottom: 12, marginTop: 6 }}>
        {groups.map(g => (
          <div key={g.key}>
            <div className="alp-sec" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px 6px" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: barColor[g.tone], flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: g.tone === "err" ? "var(--status-issue)" : "var(--ivory-text-3)" }}>{g.title}</span>
              <span style={{ flex: 1, height: 1, background: "var(--ivory-border)" }} />
              <span style={{ ...AL_NUM, fontSize: 10, color: "var(--ivory-text-3)" }}>{String(g.items.length).padStart(2, "0")}</span>
            </div>
            {g.items.map(it => (
              <div key={it.id} className="alp-row" onClick={() => onOpen && onOpen(it)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
                borderBottom: "1px solid var(--ivory-border)", cursor: "pointer",
              }}>
                <div style={{ width: 3, height: 38, borderRadius: 2, flexShrink: 0, background: barColor[g.tone] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.2px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, minWidth: 0 }}>
                    <span style={{ ...AL_NUM, fontSize: 11, color: "var(--ivory-text-3)", whiteSpace: "nowrap", flexShrink: 0 }}>{it.id}</span>
                    <span style={{ width: 2, height: 2, borderRadius: 999, background: "var(--ivory-text-3)", opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: g.tone === "err" ? "var(--status-issue)" : "var(--status-maintenance)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{it.detail}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: isRtl ? "flex-start" : "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.1px", whiteSpace: "nowrap", ...pillStyle[g.tone] }}>{it.pill}</span>
                  <span style={{ ...AL_NUM, fontSize: 10, color: "var(--ivory-text-3)", whiteSpace: "nowrap" }}>{it.time}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
window.AlertsScreenPro = AlertsScreenPro;
