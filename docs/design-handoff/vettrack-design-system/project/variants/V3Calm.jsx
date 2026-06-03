// V3 Calm Clinical — premium whitespace, one focal moment, big touch targets.
function V3Calm({ dir = "ltr", strings }) {
  const isRtl = dir === "rtl";
  const t = strings || {
    today: "Sunday · 4 May",
    greet: "Maya",
    sub: "ICU shift · 12:48",
    cardKicker: "Next on your shift",
    cardTitle: "Sterilize crash cart C-2",
    cardBody: "Epinephrine restock + sterilization cycle. Due before 17:00.",
    cardEta: "in 12 min",
    cardCta: "Start task",
    secondaryHead: "Today",
    secondary: [
      { label: "Active patients",  value: "18", icon: "users" },
      { label: "Tasks due",        value: "12", icon: "listTodo" },
      { label: "Alerts to review", value: "3",  icon: "shieldAlert" },
    ],
    feedHead: "Recently",
    feed: [
      { name: "ECG Monitor uMEC10",     action: "scanned", time: "2 min" },
      { name: "Syringe Pump SP-118",    action: "returned by Daniel", time: "23 min" },
      { name: "Defibrillator EQ-0492",  action: "flagged for sterilization", time: "1 hr" },
    ],
  };
  return (
    <div dir={dir} style={{ padding: "18px 18px 96px", background: "var(--background)", display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Greeting */}
      <div style={{ marginTop: 4 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ivory-text-3)", letterSpacing: "0.02em" }}>{t.today}</p>
        <h1 style={{ margin: "8px 0 4px", fontSize: 36, fontWeight: 300, color: "var(--ivory-text)", letterSpacing: "-0.03em", lineHeight: 1 }}>
          {isRtl ? "שלום, " : "Hello, "}
          <span style={{ fontWeight: 700, color: "var(--primary)" }}>{t.greet}</span>
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ivory-text-3)" }}>{t.sub}</p>
      </div>

      {/* Focal card — the one moment that matters right now */}
      <div style={{
        position: "relative", padding: "22px 22px 20px",
        borderRadius: 24,
        background: "var(--ivory-surface)",
        border: "1px solid var(--ivory-border)",
        boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.05), 0 22px 40px -24px rgb(15 23 42 / 0.2)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--primary)" }}>{t.cardKicker}</p>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 999,
            background: "hsl(38 92% 50% / 0.12)", color: "#92400e",
            fontSize: 11, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
          }}>
            <Icon name="clock" size={11} />
            {t.cardEta}
          </span>
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>{t.cardTitle}</h2>
        <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--ivory-text-3)", lineHeight: 1.55 }}>{t.cardBody}</p>
        <button style={{
          width: "100%", height: 52, borderRadius: 16, border: 0,
          background: "var(--primary)", color: "#fff",
          fontSize: 15, fontWeight: 700, fontFamily: "var(--font-sans)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: "0 10px 22px -10px rgb(15 31 17 / 0.45)",
        }}>
          {t.cardCta}
          <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={18} />
        </button>
      </div>

      {/* Secondary metrics — list, not grid */}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.secondaryHead}</p>
        <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 18, overflow: "hidden" }}>
          {t.secondary.map((s, i) => (
            <div key={i} style={{
              padding: "16px 18px",
              borderBottom: i === t.secondary.length - 1 ? "none" : "1px solid hsl(40 12% 81% / 0.6)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 12,
                  background: "var(--ivory-bg)", color: "var(--ivory-text-2)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}><Icon name={s.icon} size={17} /></span>
                <span style={{ fontSize: 14.5, fontWeight: 500, color: "var(--ivory-text)" }}>{s.label}</span>
              </div>
              <span style={{ fontSize: 24, fontWeight: 600, color: "var(--ivory-text)", fontFeatureSettings: "'tnum' 1", letterSpacing: "-0.015em" }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recently */}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.feedHead}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {t.feed.map((f, i) => (
            <div key={i} style={{
              padding: "12px 4px",
              borderBottom: i === t.feed.length - 1 ? "none" : "1px solid hsl(40 12% 81% / 0.5)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ivory-text-3)" }}>{f.action}</p>
              </div>
              <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap" }}>{f.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.V3Calm = V3Calm;
