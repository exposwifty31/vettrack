// Variant C — "Clinical Mono / Hero Band"
// Premium clinical app feel. Deep-green hero band carrying shift summary,
// larger card radii (22px), softer/longer shadows, patient-first content.

function ClinicalMonoDashboard({ data }) {
  const d = data;
  const isRtl = d.dir === "rtl";

  const STATUS_DOT = { ok: "#16a34a", issue: "#dc2626", maintenance: "#d97706", sterilized: "#2563eb" };
  const PATIENT_TONE = {
    critical: { bg: "#fff1f1", fg: "#7f1d1d", dot: "#dc2626" },
    stable:   { bg: "#f0faf2", fg: "#166534", dot: "#16a34a" },
    "post-op":{ bg: "#eff6ff", fg: "#1e40af", dot: "#2563eb" },
  };

  return (
    <div dir={d.dir} style={{ minHeight: "100%", background: "var(--ivory-bg)", color: "var(--ivory-text)", fontFamily: "var(--font-sans)", paddingBottom: 96 }}>
      {/* Hero band — full-bleed primary green */}
      <section style={{ position: "relative", padding: "20px 20px 36px", color: "#fff", background: "linear-gradient(165deg, hsl(130 42% 14%) 0%, hsl(130 42% 22%) 60%, hsl(125 38% 28%) 100%)", overflow: "hidden" }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: 0.22, background: "radial-gradient(700px 280px at 80% -10%, rgba(76,222,106,0.5), transparent 55%), radial-gradient(500px 220px at 10% 100%, rgba(255,255,255,0.18), transparent 55%)" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.16em" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#4cde6a" }} />
              {isRtl ? "מקוון" : "Live"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button aria-label="bell" style={{ width: 36, height: 36, borderRadius: 11, background: "rgba(255,255,255,0.12)", color: "#fff", border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="bell" size={16} /></button>
              <span style={{ width: 36, height: 36, borderRadius: 11, background: "#4cde6a", color: "#091308", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>LG</span>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, opacity: 0.78, textTransform: "uppercase", letterSpacing: "0.18em" }}>{d.greetingKicker}</p>
          <h1 style={{ margin: "8px 0 4px", fontSize: 28, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.02em" }}>{d.greetingName}</h1>
          <p style={{ margin: "0 0 22px", fontSize: 13, opacity: 0.82 }}>{d.greetingMeta}</p>
          {/* Hero stat */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, opacity: 0.78, textTransform: "uppercase", letterSpacing: "0.14em" }}>{d.shiftLabel}</p>
              <p style={{ margin: "4px 0 0", fontSize: 46, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, fontFeatureSettings: "'tnum' 1" }}>{d.shiftValue}</p>
              <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.82 }}>{d.shiftMeta}</p>
            </div>
            <button aria-label="scan" style={{ width: 60, height: 60, borderRadius: 20, background: "#4cde6a", color: "#091308", border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 28px -10px rgba(76,222,106,0.4)" }}>
              <Icon name="scan" size={24} />
            </button>
          </div>
        </div>
      </section>

      <main style={{ padding: "0 16px 24px", marginTop: -24, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* KPI strip — horizontal, 4 columns, raised pill */}
        <section style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 22, padding: "16px 14px", boxShadow: "0 18px 40px -22px rgba(15,31,17,0.25)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
            {d.kpis.map((k, i) => (
              <div key={i} style={{ borderInlineStart: i ? "1px solid hsl(40 12% 81% / 0.7)" : undefined, padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ivory-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.02em", fontFeatureSettings: "'tnum' 1" }}>{k.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Patients */}
        <section style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 22, padding: 18, boxShadow: "0 18px 40px -28px rgba(15,31,17,0.22)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ivory-text)", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--primary)" }}><Icon name="pawPrint" size={16} /></span>
              {d.patientsTitle}
            </h2>
            <a href="#" style={{ fontSize: 12, color: "var(--ivory-text-3)", textDecoration: "none" }}>{d.alertsViewAll} →</a>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {d.patients.map((p, i) => {
              const t = PATIENT_TONE[p.status];
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderRadius: 14 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 14, background: "hsl(42 18% 91% / 0.8)", color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name="pawPrint" size={18} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ivory-text)" }}>{p.name}</p>
                    <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "var(--ivory-text-3)" }}>{p.species} · {p.room}</p>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 10.5, fontWeight: 600, flexShrink: 0 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 999, background: t.dot }} />
                    {d.statusLabel[p.status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Live activity — compact */}
        <section style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 22, padding: 18, boxShadow: "0 18px 40px -28px rgba(15,31,17,0.22)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ivory-text)", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--primary)" }}><Icon name="activity" size={15} /></span>
              {d.activityTitle}
            </h2>
            <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFamily: "var(--font-mono)" }}>{d.activityCount}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {d.activity.slice(0, 3).map((a, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: i ? "1px solid hsl(40 12% 81% / 0.5)" : 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_DOT[a.status], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: "var(--ivory-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
                  <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{a.action}</p>
                </div>
                <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{a.when}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Bottom nav — soft floating bar */}
      <nav style={{ position: "absolute", insetInline: 14, bottom: 12, height: 64, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "0 12px", background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", boxShadow: "0 20px 40px -16px rgba(15,31,17,0.25)" }}>
        {["home","pawPrint","listTodo","receipt","user"].map((ic, i) => (
          <button key={i} style={{
            width: 44, height: 44, borderRadius: 14, border: 0,
            background: i === 0 ? "hsl(130 42% 20% / 0.1)" : "transparent",
            color: i === 0 ? "var(--primary)" : "var(--ivory-text-3)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name={ic} size={18} />
          </button>
        ))}
      </nav>
    </div>
  );
}

window.ClinicalMonoDashboard = ClinicalMonoDashboard;
