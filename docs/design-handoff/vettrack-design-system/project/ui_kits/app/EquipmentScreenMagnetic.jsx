// Equipment — magnetic. Hero scan CTA up front. "Just used" pulse on recent items.
// Health score chip. Matches V4's mature clinical palette.
function EquipmentScreenMagnetic({ dir = "ltr", onScan }) {
  const isRtl = dir === "rtl";
  const items = [
    { name: isRtl ? "מוניטור Mindray uMEC10" : "ECG Monitor uMEC10", room: "ICU 1", last: isRtl ? "לפני 2ד׳" : "2 min ago",  status: "ok",     fresh: true,  animal: isRtl ? "בלה · לאב" : "Bella · Lab" },
    { name: isRtl ? "משאבת מזרק SP-118" : "Syringe Pump SP-118",     room: "ICU 2", last: isRtl ? "לפני 23ד׳" : "23 min ago", status: "ok",     fresh: false, animal: isRtl ? "לוקי · DSH" : "Loki · DSH" },
    { name: isRtl ? "דפיברילטור EQ-0492" : "Defibrillator EQ-0492",  room: "OR 3",  last: isRtl ? "לפני 1ש׳" : "1 hr ago",    status: "review", fresh: false },
    { name: isRtl ? "מנשם Hamilton C1" : "Ventilator Hamilton C1",   room: "ICU 1", last: isRtl ? "לפני 2ש׳" : "2 hr ago",    status: "ster",   fresh: false },
    { name: isRtl ? "תחנת הרדמה" : "Anesthesia Workstation",         room: "OR 3",  last: isRtl ? "לפני 3ש׳" : "3 hr ago",    status: "maint",  fresh: false },
  ];
  const tone = {
    ok:     { label: isRtl ? "פעיל" : "Operational", bg: "#ecf6ee", fg: "#1a3d28", dot: "#34d399", bd: "#c7e3cf" },
    review: { label: isRtl ? "דורש בדיקה" : "Review",  bg: "#fef2f2", fg: "#7c2d12", dot: "#dc2626", bd: "#fecaca" },
    ster:   { label: isRtl ? "מעוקר" : "Sterilized",   bg: "#eef4fa", fg: "#1e3a5f", dot: "#3b82f6", bd: "#c7d8ee" },
    maint:  { label: isRtl ? "תחזוקה" : "Maintenance", bg: "#fdf6e7", fg: "#78350f", dot: "#d97706", bd: "#f0dba8" },
  };
  const score = 92;
  const ok = items.filter(i => i.status === "ok").length;

  return (
    <div dir={dir} style={{
      padding: "8px 14px 110px",
      background: "var(--background)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <style>{`
        @keyframes equipPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--action-pulse, rgba(34,197,94,0.45)); }
          70% { box-shadow: 0 0 0 10px rgba(34,197,94,0); }
        }
        @keyframes equipFade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .eq-fade { animation: equipFade 600ms cubic-bezier(0.2,0.8,0.2,1) both; }
      `}</style>

      {/* Header — glance only */}
      <div className="eq-fade" style={{ paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.025em" }}>{isRtl ? "ציוד" : "Equipment"}</h1>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 10px", borderRadius: 999,
            background: "var(--action-soft)", color: "var(--action-ink)", border: "1px solid var(--action-border)",
            fontSize: 11.5, fontWeight: 700, fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap",
          }}>
            <Icon name="check" size={11} />
            {ok}/{items.length} {isRtl ? "תקינים" : "healthy"}
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ivory-text-3)" }}>
          {isRtl ? "ציון בריאות היום" : "Health score today"} · <span style={{ color: "var(--action-ink)", fontWeight: 600 }}>{score}%</span>
        </p>
      </div>

      {/* Scan hero — thumb zone primary action */}
      <button onClick={onScan} className="eq-fade" style={{
        position: "relative", overflow: "hidden",
        borderRadius: 20, padding: "18px 18px 16px", border: 0, cursor: "pointer",
        background: "radial-gradient(circle at 85% 0%, rgba(255,255,255,0.12), transparent 60%), linear-gradient(155deg, var(--hero-a) 0%, var(--hero-b) 100%)",
        color: "#fff", textAlign: isRtl ? "right" : "left",
        boxShadow: "0 18px 36px -20px var(--brand-shadow), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{isRtl ? "אופן מהיר" : "Fast lane"}</p>
            <p style={{ margin: "4px 0 2px", fontSize: 18, fontWeight: 700, letterSpacing: "-0.015em" }}>{isRtl ? "סרוק כל ציוד" : "Scan any equipment"}</p>
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.65)" }}>{isRtl ? "QR או NFC · 1-2 שניות" : "QR or NFC · 1-2 seconds"}</p>
          </div>
          <span style={{
            width: 56, height: 56, borderRadius: 18, flexShrink: 0,
            background: "rgba(255,255,255,0.12)", color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
          }}><Icon name="scanLine" size={26} /></span>
        </div>
      </button>

      {/* Search + filter */}
      <div className="eq-fade" style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", [isRtl ? "right" : "left"]: 14, color: "var(--ivory-text-3)" }}>
            <Icon name="search" size={15} />
          </span>
          <input
            dir={dir}
            placeholder={isRtl ? "חיפוש…" : "Search…"}
            style={{
              width: "100%", height: 44, borderRadius: 14, border: "1px solid var(--ivory-border)",
              background: "var(--ivory-surface)", padding: isRtl ? "0 40px 0 16px" : "0 16px 0 40px",
              fontSize: 14, color: "var(--ivory-text)", outline: "none",
              fontFamily: "var(--font-sans)", boxSizing: "border-box",
            }}
          />
        </div>
        <button style={{ height: 44, width: 44, borderRadius: 14, background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Icon name="folder" size={17} />
        </button>
      </div>

      {/* Chips */}
      <div className="eq-fade" style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {(isRtl ? ["הכל", "פעיל", "דורש בדיקה", "תחזוקה", "מעוקר"] : ["All", "Operational", "Review", "Maintenance", "Sterilized"]).map((c, i) => (
          <span key={c} style={{
            display: "inline-flex", alignItems: "center", padding: "0 14px", height: 32, borderRadius: 999,
            border: `1px solid ${i === 0 ? "var(--brand)" : "var(--ivory-border)"}`,
            background: i === 0 ? "var(--brand)" : "var(--ivory-surface)",
            color: i === 0 ? "#fff" : "var(--ivory-text-3)",
            fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
          }}>{c}</span>
        ))}
      </div>

      {/* Items */}
      <div className="eq-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((eq, i) => {
          const t = tone[eq.status];
          return (
            <div key={i} style={{
              background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
              borderRadius: 14, padding: 12,
              display: "flex", alignItems: "center", gap: 12, position: "relative",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: "var(--ivory-bg)", color: "var(--ivory-text-3)",
                display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative",
              }}>
                <Icon name="package" size={18} />
                {eq.fresh && (
                  <span style={{
                    position: "absolute", top: -2, [isRtl ? "left" : "right"]: -2,
                    width: 10, height: 10, borderRadius: 999, background: "var(--action)",
                    border: "2px solid var(--ivory-surface)",
                    animation: "equipPulse 2.2s ease-out infinite",
                  }} />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{eq.name}</p>
                  {eq.fresh && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                      color: "var(--action-ink)", background: "var(--action-soft)", padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                    }}>{isRtl ? "טרי" : "Just used"}</span>
                  )}
                </div>
                {eq.animal && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: "var(--brand)", marginBottom: 2 }}>
                    <Icon name="pawPrint" size={11} /> {isRtl ? `בשימוש · ${eq.animal}` : `In use · ${eq.animal}`}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ivory-text-3)" }}>
                  <Icon name="mapPin" size={11} /> {eq.room} <span style={{ opacity: 0.5 }}>·</span> {eq.last}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "3px 8px", borderRadius: 6,
                  background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
                  fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: t.dot, flexShrink: 0 }} />
                  {t.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
window.EquipmentScreenMagnetic = EquipmentScreenMagnetic;
