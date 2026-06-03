// Recap screen — the achievement layer. Weekly summary card + monthly impact
// + shareable shift card. This is the "open the app for no reason" surface.
function ShiftRecapScreen({ dir = "ltr", onShare }) {
  const isRtl = dir === "rtl";
  const stats = [
    { label: isRtl ? "סריקות" : "Scans",           value: 142, delta: "+18", icon: "scanLine" },
    { label: isRtl ? "מטופלים" : "Patients",       value: 47,  delta: "+6",  icon: "users"    },
    { label: isRtl ? "בלי איחור" : "On-time rate", value: "98%", delta: "+4%", icon: "check"  },
    { label: isRtl ? "שעות שמורות" : "Time saved", value: "11h", delta: "+2h", icon: "clock"  },
  ];
  const milestones = [
    { title: isRtl ? "ראשונה לסרוק ב-09:00" : "First to scan at 09:00",       date: isRtl ? "ב׳ · 28 באפר׳" : "Mon · 28 Apr",  badge: "🌅" },
    { title: isRtl ? "סגרת 8 משימות ביום" : "Closed 8 tasks in a single day", date: isRtl ? "ד׳ · 30 באפר׳" : "Wed · 30 Apr",  badge: "⚡" },
    { title: isRtl ? "5 משמרות נקיות ברצף" : "5 clean shifts in a row",       date: isRtl ? "ש׳ · 3 במאי" : "Sat · 3 May",     badge: "🏅" },
  ];

  return (
    <div dir={dir} style={{
      padding: "8px 14px 110px",
      background: "var(--background)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <style>{`
        @keyframes recapFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .rc-fade { animation: recapFade 600ms cubic-bezier(0.2,0.8,0.2,1) both; }
      `}</style>

      {/* Header */}
      <div className="rc-fade" style={{ paddingTop: 6 }}>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--brand)" }}>{isRtl ? "השבוע שלך" : "Your week"}</p>
        <h1 style={{ margin: "8px 0 4px", fontSize: 28, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>
          {isRtl ? "כל הכבוד, מאיה." : "Nicely done, Maya."}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ivory-text-3)", lineHeight: 1.45 }}>
          {isRtl ? "השבוע ה-18 של 2026 · 5 משמרות" : "Week 18 of 2026 · 5 shifts"}
        </p>
      </div>

      {/* Shareable shift card */}
      <div className="rc-fade" style={{
        position: "relative", overflow: "hidden",
        borderRadius: 22, padding: "20px 18px 18px",
        background: "radial-gradient(circle at 12% 0%, rgba(255,255,255,0.14), transparent 55%), radial-gradient(circle at 100% 100%, rgba(224,184,122,0.12), transparent 55%), linear-gradient(155deg, var(--hero-a) 0%, var(--hero-b) 100%)",
        color: "#fff",
        boxShadow: "0 20px 40px -20px var(--brand-shadow), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="qrCode" size={14} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>VetTrack</span>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{isRtl ? "כרטיס משמרת" : "Shift card"}</span>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.55)", letterSpacing: "0.02em" }}>{isRtl ? "השבוע שלי במספרים" : "My week, by the numbers"}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{
                width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                background: "rgba(255,255,255,0.08)", color: "#a8b5b0",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
              }}><Icon name={s.icon} size={15} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", fontFamily: "var(--font-num)" }}>{s.value}</span>
                  <span style={{ fontSize: 10.5, color: "var(--action)", fontWeight: 600, fontFamily: "var(--font-num)" }}>{s.delta}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", letterSpacing: "0.01em", marginTop: 1, whiteSpace: "nowrap" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "16px 0 14px" }} />

        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
          {isRtl ? "11 שעות חזרו לטיפול בחיות. ככה זה נראה כשמערכת עובדת בשבילך, לא במקומך." : "11 hours back in your shifts. That's what a system working for you — not on top of you — looks like."}
        </p>

        <button onClick={onShare} style={{
          marginTop: 16, width: "100%", height: 50, borderRadius: 14, border: 0,
          background: "rgba(255,255,255,0.12)", color: "#fff",
          fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
        }}>
          <Icon name="arrowUpRight" size={15} />
          {isRtl ? "שתף את המשמרת" : "Share my shift card"}
        </button>
      </div>

      {/* Milestones */}
      <div className="rc-fade">
        <p style={{ margin: "2px 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{isRtl ? "אבני דרך" : "Milestones"}</p>
        <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 16, overflow: "hidden" }}>
          {milestones.map((m, i) => (
            <div key={i} style={{
              padding: "12px 14px",
              borderBottom: i === milestones.length - 1 ? "none" : "1px solid var(--ivory-border)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{m.badge}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{m.title}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{m.date}</p>
              </div>
              <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={15} className="" />
            </div>
          ))}
        </div>
      </div>

      {/* Monthly preview */}
      <div className="rc-fade" style={{
        background: "linear-gradient(135deg, #fbf7eb 0%, #f5edd6 100%)",
        border: "1px solid #ead9b0",
        borderRadius: 16, padding: "14px 16px",
      }}>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#92400e" }}>{isRtl ? "סקירה חודשית" : "Monthly recap"}</p>
        <p style={{ margin: "6px 0 2px", fontSize: 14.5, fontWeight: 600, color: "#1c2a18", letterSpacing: "-0.005em" }}>
          {isRtl ? "אפריל נסגר ב-31 במאי" : "April recap drops 31 May"}
        </p>
        <p style={{ margin: 0, fontSize: 11.5, color: "#78350f" }}>{isRtl ? "PDF + כרטיס חודש לשתף עם הצוות" : "PDF + a card to share with the team"}</p>
      </div>
    </div>
  );
}
window.ShiftRecapScreen = ShiftRecapScreen;
