// Variant B — "Ops Terminal"
// Bloomberg-style ops density. IBM Plex Mono dominates. Tabular numerics,
// uppercase mono labels, flat dividers, tighter radii.

function OpsTerminalDashboard({ data }) {
  const d = data;
  const isRtl = d.dir === "rtl";
  const mono = { fontFamily: "var(--font-mono)" };

  const STATUS_DOT = {
    ok: "#16a34a", issue: "#dc2626", maintenance: "#d97706", sterilized: "#2563eb",
  };
  const STATUS_CODE = {
    ok: isRtl ? "תקין" : "OK",
    issue: isRtl ? "תקלה" : "REV",
    maintenance: isRtl ? "תחזק" : "MNT",
    sterilized: isRtl ? "עיקור" : "STR",
  };
  const TONE_CODE = {
    issue: { color: "#dc2626", code: isRtl ? "תקלה" : "REV" },
    maintenance: { color: "#d97706", code: isRtl ? "תחזק" : "MNT" },
    sterilized: { color: "#2563eb", code: isRtl ? "עיקור" : "STR" },
  };

  return (
    <div dir={d.dir} style={{ minHeight: "100%", background: "#0c1a0e", color: "#dbe6dc", fontFamily: "var(--font-sans)", paddingBottom: 88 }}>
      {/* Status strip — deep forest band with mono ID */}
      <header style={{ background: "#091308", padding: "10px 14px", borderBottom: "1px solid #1f3322", display: "flex", alignItems: "center", justifyContent: "space-between", ...mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        <span style={{ color: "#4cde6a", fontWeight: 600 }}>● {isRtl ? "מקוון" : "LIVE"}</span>
        <span style={{ color: "#a8c4ad" }}>OPS · DAY 08:00→16:00 · LIAT GOLAN</span>
        <span style={{ color: "#a8c4ad" }}>v1.1.1</span>
      </header>

      {/* Brand strip */}
      <div style={{ padding: "16px 16px 8px", borderBottom: "1px solid #1f3322" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: 0, ...mono, fontSize: 10.5, color: "#62876b", textTransform: "uppercase", letterSpacing: "0.18em" }}>{d.greetingKicker}</p>
            <h1 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, color: "#ece9e0", letterSpacing: "-0.015em" }}>{d.greetingName}</h1>
            <p style={{ margin: "4px 0 0", ...mono, fontSize: 11, color: "#62876b" }}>{d.greetingMeta}</p>
          </div>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "#4cde6a", color: "#091308", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="qrCode" size={18} /></span>
        </div>
      </div>

      <main style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Shift capture — flat hero */}
        <section style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p style={{ margin: 0, ...mono, fontSize: 10, color: "#62876b", textTransform: "uppercase", letterSpacing: "0.18em" }}>{d.shiftLabel}</p>
            <p style={{ margin: "4px 0 0", fontSize: 38, fontWeight: 800, color: "#4cde6a", letterSpacing: "-0.03em", fontFeatureSettings: "'tnum' 1", ...mono }}>{d.shiftValue}</p>
          </div>
          <div style={{ ...mono, fontSize: 10.5, color: "#a8c4ad", textAlign: isRtl ? "left" : "right", maxWidth: 160 }}>{d.shiftMeta}</div>
        </section>

        {/* KPI tabular block — 4 columns separated by mono dividers */}
        <section style={{ border: "1px solid #1f3322", borderRadius: 8, background: "#0e2110", padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            {d.kpis.map((k, i) => (
              <div key={i} style={{
                padding: "12px 10px",
                borderInlineStart: i ? "1px solid #1f3322" : undefined,
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <span style={{ ...mono, fontSize: 9.5, color: "#62876b", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#ece9e0", letterSpacing: "-0.02em", fontFeatureSettings: "'tnum' 1", ...mono }}>{k.value}</span>
                <span style={{ ...mono, fontSize: 9.5, color: "#62876b" }}>{k.sub}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Quick actions — mono labels with bracketed shortcuts */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {d.actions.map((a, i) => (
            <button key={a.id} style={{
              background: a.primary ? "#4cde6a" : "#0e2110",
              color: a.primary ? "#091308" : "#dbe6dc",
              border: a.primary ? 0 : "1px solid #1f3322",
              borderRadius: 8, padding: "12px 14px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              cursor: "pointer", ...mono,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <Icon name={a.icon} size={14} /> {a.label}
              </span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>[{i + 1}]</span>
            </button>
          ))}
        </section>

        {/* Activity — mono lines with timestamps in primary */}
        <section style={{ background: "#0e2110", border: "1px solid #1f3322", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #1f3322", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, ...mono, fontSize: 11, color: "#a8c4ad", textTransform: "uppercase", letterSpacing: "0.12em" }}>// {d.activityTitle}</h2>
            <span style={{ ...mono, fontSize: 10.5, color: "#4cde6a" }}>{d.activityCount}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {d.activity.map((a, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < d.activity.length - 1 ? "1px solid #1a2c1c" : 0, ...mono, fontSize: 11.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[a.status], flexShrink: 0 }} />
                <span style={{ color: "#4cde6a", flexShrink: 0, width: 38 }}>{a.when}</span>
                <span style={{ color: "#ece9e0", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                <span style={{ color: "#62876b", flexShrink: 0, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{STATUS_CODE[a.status]}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Alerts — mono single-line items with code prefixes */}
        <section style={{ background: "#0e2110", border: "1px solid #1f3322", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #1f3322", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, ...mono, fontSize: 11, color: "#a8c4ad", textTransform: "uppercase", letterSpacing: "0.12em" }}>! {d.alertsTitle}</h2>
            <a href="#" style={{ ...mono, fontSize: 10.5, color: "#a8c4ad", textDecoration: "none" }}>[{d.alertsViewAll}]</a>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {d.alerts.map((a, i) => {
              const t = TONE_CODE[a.tone];
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: i < d.alerts.length - 1 ? "1px solid #1a2c1c" : 0 }}>
                  <span style={{ ...mono, fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}55`, letterSpacing: "0.05em", flexShrink: 0 }}>{t.code}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, ...mono, fontSize: 12, fontWeight: 600, color: "#ece9e0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
                    <p style={{ margin: "1px 0 0", ...mono, fontSize: 10.5, color: "#62876b" }}>{a.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {/* Bottom nav — mono labels */}
      <nav style={{ position: "absolute", insetInline: 0, bottom: 0, height: 64, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "0 8px", background: "#091308", borderTop: "1px solid #1f3322" }}>
        {["home","pawPrint","scan","listTodo","menu"].map((ic, i) => {
          const isCenter = i === 2;
          if (isCenter) {
            return (
              <button key={i} style={{ width: 50, height: 50, borderRadius: 10, background: "#4cde6a", color: "#091308", border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={ic} size={20} />
              </button>
            );
          }
          return (
            <button key={i} style={{ flex: 1, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2, background: "transparent", border: 0, color: i === 0 ? "#4cde6a" : "#62876b", ...mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              <Icon name={ic} size={16} />
              <span>{d.nav[i]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

window.OpsTerminalDashboard = OpsTerminalDashboard;
