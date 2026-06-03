// ScanResultScreen — the post-scan destination. Dark hero success banner →
// required actions (amber) → optional → item details → recent history.
// Adapted from the user's vettrack-scan.html, fully tokenized + DM Mono numerics.
const SR_NUM = { fontFamily: "var(--font-num)" };

function ScanResultScreen({ dir = "ltr", onClose, onAction }) {
  const isRtl = dir === "rtl";

  const required = [
    {
      title: isRtl ? "חידוש אדרנלין" : "Epinephrine restock",
      desc: isRtl ? "המלאי מתחת לסף המינימום. חדש לפני החזרת העגלה לשירות." : "Stock is below minimum threshold. Restock before returning cart to service.",
      cta: isRtl ? "תעד חידוש" : "Log restock", icon: "plus",
    },
    {
      title: isRtl ? "הרץ מחזור עיקור" : "Run sterilization cycle",
      desc: isRtl ? "העיקור באיחור של 14 שעות. השלם מחזור לפני השימוש הבא." : "Sterilization is overdue by 14 hours. Complete cycle before next use.",
      cta: isRtl ? "התחל מחזור" : "Start cycle", icon: "wrench",
    },
  ];
  const details = [
    { k: isRtl ? "סוג" : "Type",            v: isRtl ? "עגלת חירום" : "Crash Cart", tone: "" },
    { k: isRtl ? "מספר סידורי" : "Serial",   v: "CC-02-2022-004", tone: "mono" },
    { k: isRtl ? "סטטוס" : "Status",         v: isRtl ? "מלאי נמוך" : "Low stock", tone: "warn" },
    { k: isRtl ? "עוקר לאחרונה" : "Last sterilized", v: isRtl ? "אתמול 19:12" : "Yesterday 19:12", tone: "warn" },
    { k: isRtl ? "בדיקה הבאה" : "Next check due", v: isRtl ? "היום 22:00" : "Today 22:00", tone: "" },
  ];
  const history = [
    { title: isRtl ? "חודש · אטרופין" : "Restocked · Atropine", who: "Daniel", time: isRtl ? "לפני 2ש'" : "2h ago" },
    { title: isRtl ? "עיקור הושלם" : "Sterilization completed", who: "Maya", time: isRtl ? "אתמול" : "Yesterday" },
    { title: isRtl ? "בדיקה שגרתית" : "Routine check", who: "Lior", time: isRtl ? "לפני יומיים" : "2d ago" },
  ];

  const label = (txt) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--ivory-text-3)", padding: "0 4px", margin: "16px 0 8px" }}>{txt}</div>
  );
  const card = {
    background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
    borderRadius: 14, padding: 16, marginBottom: 8,
  };

  return (
    <div dir={dir} style={{ background: "var(--background)", minHeight: "100%" }}>
      <style>{`@keyframes srUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } } .sr-up { animation: srUp 0.35s ease both; }`}</style>

      <div style={{ padding: "14px 18px 80px" }}>
        {/* Success banner */}
        <div className="sr-up" style={{
          position: "relative", overflow: "hidden", borderRadius: 18, padding: 18, marginBottom: 14,
          background: "linear-gradient(155deg, var(--hero-a) 0%, var(--hero-b) 100%)", color: "#fff",
          boxShadow: "0 16px 32px -18px var(--brand-shadow)",
        }}>
          <div aria-hidden="true" style={{ position: "absolute", top: -30, insetInlineEnd: -30, width: 130, height: 130, background: "radial-gradient(circle, var(--action) 0%, transparent 70%)", opacity: 0.35, pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", borderRadius: 100, padding: "4px 10px" }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--action)" }} />
                <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>{isRtl ? "סריקת NFC · הצלחה" : "NFC scan · success"}</span>
              </span>
              <span style={{ ...SR_NUM, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>09:41:22</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.2, marginBottom: 4 }}>{isRtl ? "עגלת חירום C-2" : "Crash Cart C-2"}</div>
            <div style={{ ...SR_NUM, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>CC-02</div>
            <div style={{ display: "flex", gap: 16, marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              {[
                { l: isRtl ? "מיקום" : "Location", v: isRtl ? "ICU 2 · מסדרון" : "ICU 2 · Corridor" },
                { l: isRtl ? "סריקה אחרונה" : "Last scan", v: isRtl ? "לפני 2ש'" : "2h ago" },
                { l: isRtl ? "משויך ל" : "Assigned", v: "Maya" },
              ].map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{m.l}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}>{m.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Required actions */}
        {label(isRtl ? "פעולות נדרשות" : "Required actions")}
        {required.map((a, i) => (
          <div key={i} className="sr-up" style={{ ...card, borderInlineStart: "3px solid var(--status-maintenance)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.3px", lineHeight: 1.3 }}>{a.title}</div>
              <span style={{ padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 500, flexShrink: 0, background: "var(--status-maint-bg)", color: "var(--status-maint-fg)" }}>{isRtl ? "נדרש" : "Required"}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--ivory-text-2)", lineHeight: 1.5, marginBottom: 14 }}>{a.desc}</div>
            <button onClick={() => onAction && onAction(a.title)} style={{
              width: "100%", height: 44, borderRadius: 10, border: 0, cursor: "pointer",
              background: "var(--brand)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}><Icon name={a.icon} size={15} /> {a.cta}</button>
          </div>
        ))}

        {/* Optional */}
        {label(isRtl ? "אופציונלי" : "Optional")}
        <div className="sr-up" style={{ ...card, borderInlineStart: "3px solid var(--ivory-border-md)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.3px" }}>{isRtl ? "הוסף הערה" : "Add note"}</div>
            <span style={{ padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 500, flexShrink: 0, background: "var(--ivory-bg)", color: "var(--ivory-text-3)" }}>{isRtl ? "אופציונלי" : "Optional"}</span>
          </div>
          <button style={{
            width: "100%", height: 44, borderRadius: 10, border: "1px solid var(--ivory-border)", cursor: "pointer",
            background: "var(--ivory-bg)", color: "var(--ivory-text)", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}><Icon name="edit" size={15} /> {isRtl ? "כתוב הערה" : "Write note"}</button>
        </div>

        {/* Item details */}
        {label(isRtl ? "פרטי פריט" : "Item details")}
        <div className="sr-up" style={card}>
          {details.map((d, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: i === 0 ? "0 0 9px" : i === details.length - 1 ? "9px 0 0" : "9px 0",
              borderBottom: i === details.length - 1 ? "none" : "1px solid var(--ivory-border)",
            }}>
              <span style={{ fontSize: 13, color: "var(--ivory-text-3)" }}>{d.k}</span>
              <span style={{
                fontSize: d.tone === "mono" ? 12 : 13, fontWeight: 500, textAlign: isRtl ? "left" : "right",
                fontFamily: d.tone === "mono" ? "var(--font-num)" : "var(--font-sans)",
                color: d.tone === "warn" ? "var(--status-maintenance)" : d.tone === "ok" ? "var(--action-ink)" : "var(--ivory-text)",
              }}>{d.v}</span>
            </div>
          ))}
        </div>

        {/* History */}
        {label(isRtl ? "היסטוריה אחרונה" : "Recent history")}
        <div className="sr-up" style={card}>
          {history.map((h, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
              borderBottom: i === history.length - 1 ? "none" : "1px solid var(--ivory-border)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--action)", border: "1.5px solid var(--action)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ivory-text)" }}>{h.title}</div>
                <div style={{ fontSize: 11, color: "var(--ivory-text-3)", marginTop: 1 }}>{h.who}</div>
              </div>
              <span style={{ ...SR_NUM, fontSize: 10, color: "var(--ivory-text-3)", flexShrink: 0 }}>{h.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.ScanResultScreen = ScanResultScreen;
