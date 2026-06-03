// V2 Operational — Bloomberg-terminal density. Mono details, status-led, tabular feed.
function V2Operational({ dir = "ltr", strings }) {
  const isRtl = dir === "rtl";
  const t = strings || {
    shiftBar: { mode: "ICU shift", who: "Maya · DVM", time: "07:00 → 19:00", remaining: "5h 12m left" },
    statusStrip: [
      { label: "ICU 1", val: "8 pts", tone: "ok" },
      { label: "ICU 2", val: "6 pts", tone: "ok" },
      { label: "OR 3",  val: "2 pts", tone: "warn" },
      { label: "ER",    val: "2 pts", tone: "err" },
    ],
    kpis: [
      { label: "Pts",     value: "18",   delta: "+3", tone: "ok"   },
      { label: "Tasks",   value: "12",   delta: "4↑", tone: "warn" },
      { label: "Alerts",  value: "3",    delta: "1↑", tone: "err"  },
      { label: "Billed",  value: "4,820",delta: "23×",tone: "ok"   },
      { label: "Avail.",  value: "92%",  delta: "—",  tone: "ok"   },
      { label: "Offline", value: "0",    delta: "—",  tone: "ok"   },
    ],
    feedHead: "Event log",
    cols: ["Time", "Item", "Action", "Status"],
    feed: [
      { time: "16:42", item: "uMEC10",    action: "scan / Maya",    s: "Operational" },
      { time: "16:33", item: "EQ-0492",   action: "auto-check",     s: "Due Check" },
      { time: "16:21", item: "SP-118",    action: "return / Daniel",s: "Operational" },
      { time: "15:58", item: "Hamilton",  action: "sterilize",      s: "Sterilized" },
      { time: "15:42", item: "Cart C-2",  action: "stock flag",     s: "Review Needed" },
      { time: "15:11", item: "ARKRAY",    action: "calibration",    s: "Maintenance" },
      { time: "14:52", item: "uMEC10·R2", action: "scan / Daniel",  s: "Operational" },
    ],
  };
  const dot = (k) => (k === "ok" ? "#16a34a" : k === "warn" ? "#d97706" : "#dc2626");
  const pillCfg = {
    "Operational":   { bg: "#f0faf2", fg: "#166534", bd: "#a7f3bd", dot: "#16a34a" },
    "Due Check":     { bg: "#fffbeb", fg: "#78350f", bd: "#fcd34d", dot: "#d97706" },
    "Review Needed": { bg: "#fff1f1", fg: "#7f1d1d", bd: "#fca5a5", dot: "#dc2626" },
    "Sterilized":    { bg: "#eff6ff", fg: "#1e40af", bd: "#93c5fd", dot: "#2563eb" },
    "Maintenance":   { bg: "#fffbeb", fg: "#78350f", bd: "#fcd34d", dot: "#d97706" },
  };

  return (
    <div dir={dir} style={{ padding: "10px 12px 96px", background: "var(--background)", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Shift bar */}
      <div style={{
        background: "var(--primary)", color: "#fff", borderRadius: 12,
        padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
        fontFamily: "var(--font-mono)", fontSize: 11,
        boxShadow: "0 6px 14px -8px rgb(15 31 17 / 0.45)",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#4cde6a", boxShadow: "0 0 0 3px rgba(76,222,106,0.25)" }} />
          <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{t.shiftBar.mode}</span>
          <span style={{ opacity: 0.7 }}>·</span>
          <span>{t.shiftBar.who}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ opacity: 0.8 }}>{t.shiftBar.time}</span>
          <span>{t.shiftBar.remaining}</span>
        </div>
      </div>

      {/* Status strip — wards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {t.statusStrip.map((w, i) => (
          <div key={i} style={{
            background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
            padding: "6px 10px", borderRadius: 8,
            display: "flex", flexDirection: "column", gap: 2,
            borderInlineStartWidth: 3, borderInlineStartStyle: "solid", borderInlineStartColor: dot(w.tone),
          }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{w.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ivory-text)", fontFamily: "var(--font-mono)", letterSpacing: "-0.01em" }}>{w.val}</span>
          </div>
        ))}
      </div>

      {/* 6-tile KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {t.kpis.map((k, i) => (
          <div key={i} style={{
            background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
            padding: "8px 10px", borderRadius: 8,
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{k.label}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: dot(k.tone), fontFamily: "var(--font-mono)" }}>{k.delta}</span>
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: "var(--ivory-text)", fontFamily: "var(--font-mono)", letterSpacing: "-0.015em", lineHeight: 1 }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Quick CTA bar */}
      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ flex: 2, height: 38, borderRadius: 8, border: 0, background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 12.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
          <Icon name="scanLine" size={15} /> {isRtl ? "סרוק" : "Scan"}
        </button>
        <button style={{ flex: 1, height: 38, borderRadius: 8, border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", color: "var(--ivory-text)", fontWeight: 700, fontSize: 11.5, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", cursor: "pointer" }}>HANDOFF</button>
        <button style={{ flex: 1, height: 38, borderRadius: 8, border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", color: "var(--ivory-text)", fontWeight: 700, fontSize: 11.5, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", cursor: "pointer" }}>REPORT</button>
      </div>

      {/* Event log */}
      <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{
          padding: "6px 10px", borderBottom: "1px solid var(--ivory-border)",
          background: "hsl(42 18% 91% / 0.7)", display: "flex", justifyContent: "space-between",
          fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ivory-text-3)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700,
        }}>
          <span>{t.feedHead}</span>
          <span>● LIVE · 7 in last 2h</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 80px", padding: "6px 10px", borderBottom: "1px solid var(--ivory-border)", fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--ivory-text-3)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
          {t.cols.map((col, i) => <span key={i}>{col}</span>)}
        </div>
        {t.feed.map((row, i) => {
          const p = pillCfg[row.s];
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "44px 1fr 1fr 80px",
              padding: "8px 10px", alignItems: "center",
              borderBottom: i === t.feed.length - 1 ? "none" : "1px solid hsl(40 12% 81% / 0.5)",
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ivory-text)",
            }}>
              <span style={{ color: "var(--ivory-text-3)" }}>{row.time}</span>
              <span style={{ fontWeight: 700 }}>{row.item}</span>
              <span style={{ color: "var(--ivory-text-2)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.action}</span>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 6px", borderRadius: 4, border: `1px solid ${p.bd}`, background: p.bg, color: p.fg,
                fontSize: 9.5, fontWeight: 700, fontFamily: "var(--font-sans)",
                width: "fit-content", whiteSpace: "nowrap",
              }}>
                <span style={{ width: 4, height: 4, borderRadius: 999, background: p.dot }} />
                {row.s}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.V2Operational = V2Operational;
