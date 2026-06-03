// Variant A — "Refined Clinical"
// Stays in the current visual family but tightens hierarchy, gives the shift
// stat a hero treatment, and breathes more whitespace into the KPI grid.

function RefinedDashboard({ data }) {
  const d = data;
  const isRtl = d.dir === "rtl";
  const STATUS = {
    ok:          { ic: "checkCircle", c: "#16a34a" },
    issue:       { ic: "alert",        c: "#dc2626" },
    maintenance: { ic: "wrench",       c: "#d97706" },
    sterilized:  { ic: "droplet",      c: "#2563eb" },
  };
  const TONE = {
    issue:       { bg: "#fff1f1", fg: "#7f1d1d", bd: "#fca5a5", dot: "#dc2626" },
    maintenance: { bg: "#fffbeb", fg: "#78350f", bd: "#fcd34d", dot: "#d97706" },
    sterilized:  { bg: "hsl(130 42% 20% / 0.08)", fg: "var(--primary)", bd: "hsl(130 42% 20% / 0.25)", dot: "var(--primary)" },
  };

  return (
    <div dir={d.dir} style={{ minHeight: "100%", background: "var(--ivory-bg)", color: "var(--ivory-text)", fontFamily: "var(--font-sans)", paddingBottom: 96 }}>
      {/* Top bar — minimal */}
      <header style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid var(--ivory-border)", background: "var(--ivory-surface)" }}>
        <button aria-label="menu" style={{ width: 40, height: 40, border: 0, background: "transparent", color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10 }}><Icon name="menu" size={20} /></button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16, color: "var(--ivory-text)" }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="qrCode" size={13} /></span>
          VetTrack
        </span>
        <button aria-label="profile" style={{ width: 40, height: 40, border: 0, background: "transparent", color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10 }}><Icon name="user" size={20} /></button>
      </header>

      <main style={{ padding: "24px 18px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
        {/* Greeting */}
        <section>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--primary)", letterSpacing: "0.16em", textTransform: "uppercase" }}>{d.greetingKicker}</p>
          <h1 style={{ margin: "8px 0 4px", fontSize: 28, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ivory-text)" }}>{d.greetingName}</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ivory-text-3)" }}>{d.greetingMeta}</p>
        </section>

        {/* Hero shift-capture card */}
        <section style={{
          borderRadius: 22,
          background: "linear-gradient(140deg, var(--primary) 0%, hsl(125 38% 28%) 100%)",
          color: "#fff",
          padding: "22px 22px 18px",
          position: "relative", overflow: "hidden",
          boxShadow: "0 14px 32px -16px rgb(15 31 17 / 0.4)",
        }}>
          <div aria-hidden="true" style={{ position: "absolute", insetInlineEnd: -30, top: -30, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 60%)" }} />
          <div style={{ position: "relative" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.78 }}>{d.shiftLabel}</p>
            <p style={{ margin: "8px 0 4px", fontSize: 40, fontWeight: 800, letterSpacing: "-0.025em", fontFeatureSettings: "'tnum' 1" }}>{d.shiftValue}</p>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, opacity: 0.86 }}>{d.shiftMeta}</p>
            <button style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.12)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999,
              padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>
              {isRtl ? "פתח פנקס" : "Open ledger"} <Icon name="arrowUpRight" size={13} />
            </button>
          </div>
        </section>

        {/* KPI 2x2 */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {d.kpis.map((k, i) => (
            <div key={i} style={{
              background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 16,
              padding: 14, minHeight: 116, boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
              display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ivory-text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{k.label}</span>
                <span style={{ width: 28, height: 28, borderRadius: 9, border: "1px solid var(--ivory-border)", background: "hsl(42 18% 91% / 0.7)", color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={k.icon} size={14} />
                </span>
              </div>
              <div>
                <div style={{ fontSize: 26, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.015em", color: "var(--ivory-text)", fontFeatureSettings: "'tnum' 1" }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: "var(--ivory-text-3)", marginTop: 6 }}>{k.sub}</div>
              </div>
            </div>
          ))}
        </section>

        {/* Quick action row — single horizontal row of icon chips */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {d.actions.map(a => (
            <button key={a.id} style={{
              background: a.primary ? "var(--primary)" : "var(--ivory-surface)",
              color: a.primary ? "#fff" : "var(--ivory-text)",
              border: a.primary ? 0 : "1px solid var(--ivory-border)",
              borderRadius: 14, padding: "12px 8px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer",
              boxShadow: a.primary ? "0 10px 20px -10px rgb(15 31 17 / 0.5)" : "0 1px 2px 0 rgb(15 23 42 / 0.04)",
            }}>
              <Icon name={a.icon} size={18} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{a.label}</span>
            </button>
          ))}
        </section>

        {/* Live activity */}
        <section style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 18, padding: 16, boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ivory-text)", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--primary)" }}><Icon name="activity" size={16} /></span>
              {d.activityTitle}
            </h2>
            <span style={{ padding: "2px 10px", borderRadius: 999, background: "hsl(125 32% 93%)", color: "hsl(129 15% 25%)", fontSize: 11, fontWeight: 600 }}>{d.activityCount}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {d.activity.map((a, i) => {
              const s = STATUS[a.status];
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderRadius: 10, background: i % 2 ? "transparent" : "hsl(42 18% 91% / 0.4)" }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: `${s.c}14`, color: s.c, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name={s.ic} size={13} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--ivory-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
                    <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "var(--ivory-text-3)" }}>{a.action}</p>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{a.when}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Alerts — compressed */}
        <section style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 18, padding: 16, boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ivory-text)", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--destructive)" }}><Icon name="alert" size={16} /></span>
              {d.alertsTitle}
            </h2>
            <a href="#" style={{ fontSize: 12, color: "var(--ivory-text-3)", textDecoration: "none" }}>{d.alertsViewAll} →</a>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {d.alerts.map((a, i) => {
              const t = TONE[a.tone];
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: t.bg, border: `1px solid ${t.bd}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: t.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.fg }}>{a.name}</p>
                    <p style={{ margin: "1px 0 0", fontSize: 11.5, color: t.fg, opacity: 0.78 }}>{a.detail}</p>
                  </div>
                  <span style={{ color: t.fg }}><Icon name="chevronRight" size={14} className={isRtl ? "rtl-mirror" : ""} /></span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {/* Bottom nav */}
      <nav style={{ position: "absolute", insetInline: 0, bottom: 0, height: 68, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "8px 12px", background: "var(--ivory-surface)", borderTop: "1px solid var(--ivory-border)", boxShadow: "0 -4px 24px -12px rgba(0,0,0,0.08)" }}>
        {["home","pawPrint","scan","listTodo","menu"].map((ic, i) => {
          const isCenter = i === 2;
          if (isCenter) {
            return (
              <button key={i} style={{ width: 56, height: 56, borderRadius: 18, background: "var(--primary)", color: "#fff", border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", transform: "translateY(-12px)", boxShadow: "0 10px 24px -8px rgb(15 31 17 / 0.45)" }}>
                <Icon name={ic} size={22} />
              </button>
            );
          }
          return (
            <button key={i} style={{ flex: 1, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2, background: "transparent", border: 0, color: i === 0 ? "var(--primary)" : "var(--ivory-text-3)" }}>
              <Icon name={ic} size={18} />
              <span style={{ fontSize: 10.5, fontWeight: 600 }}>{d.nav[i]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

window.RefinedDashboard = RefinedDashboard;
