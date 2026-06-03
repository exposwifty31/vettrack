// V1 Refined — current DNA but sharper hierarchy.
// Hero KPI (one focal number), secondary metric strip, richer activity rail.
function V1Refined({ dir = "ltr", strings }) {
  const isRtl = dir === "rtl";
  const t = strings || {
    today: "Today · 4 May",
    greet: "Good morning, Maya",
    sub: "ICU 1 · Shift 2 of 3 · ends 19:00",
    focalLabel: "Active patients",
    focalValue: "18",
    focalDelta: "+3 since 07:00",
    cta: "Open shift summary",
    strip: [
      { label: "Tasks due",     value: "12", sub: "4 overdue" },
      { label: "Alerts",        value: "3",  sub: "Review needed" },
      { label: "This shift",    value: "₪4,820", sub: "23 billed" },
    ],
    quickHead: "Right now",
    quick: [
      { icon: "scan",     title: "Scan equipment", hint: "QR or NFC" },
      { icon: "filePlus", title: "Add task",       hint: "Create or assign" },
      { icon: "shieldAlert", title: "Triage alerts", hint: "3 need review" },
    ],
    feedHead: "Live activity",
    feedSub: "Last 30 minutes",
    feed: [
      { name: "ECG Monitor uMEC10",      who: "Maya scanned",        time: "2m",  tone: "ok",   detail: "ICU 1 · Operational" },
      { name: "Defibrillator EQ-0492",   who: "Auto check",          time: "11m", tone: "warn", detail: "Sterilization due in 6h" },
      { name: "Syringe Pump SP-118",     who: "Daniel returned",     time: "23m", tone: "ok",   detail: "Plugged in · 30 min deadline" },
      { name: "Crash Cart C-2",          who: "Out-of-stock flag",   time: "48m", tone: "err",  detail: "Epinephrine — 0 left" },
    ],
  };
  const c = (k) => (k === "ok" ? "#16a34a" : k === "warn" ? "#d97706" : "#dc2626");
  const cBg = (k) => (k === "ok" ? "#f0faf2" : k === "warn" ? "#fffbeb" : "#fff1f1");

  return (
    <div dir={dir} style={{ padding: "14px 14px 96px", background: "var(--background)", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Greeting + today */}
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--primary)" }}>{t.today}</p>
        <h1 style={{ margin: "4px 0 2px", fontSize: 23, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.02em" }}>{t.greet}</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ivory-text-3)" }}>{t.sub}</p>
      </div>

      {/* Focal KPI card */}
      <div style={{
        position: "relative", overflow: "hidden",
        borderRadius: 20, padding: "18px 18px 16px",
        background: "linear-gradient(135deg, var(--primary) 0%, hsl(125 38% 28%) 100%)",
        color: "#fff",
        boxShadow: "0 18px 32px -16px rgb(15 31 17 / 0.45)",
      }}>
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, opacity: 0.18,
          background: "radial-gradient(circle at 80% 20%, rgba(76,222,106,0.6), transparent 50%)"
        }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.82, whiteSpace: "nowrap" }}>{t.focalLabel}</span>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "3px 9px", borderRadius: 999,
              background: "rgba(76,222,106,0.18)", color: "#4cde6a",
              fontSize: 11, fontWeight: 700, fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap", flexShrink: 0,
            }}>{t.focalDelta}</span>
          </div>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, fontFeatureSettings: "'tnum' 1", marginTop: 12 }}>{t.focalValue}</div>
          <button style={{
            marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
            height: 38, padding: "0 14px", borderRadius: 12,
            background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)",
            fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer", whiteSpace: "nowrap",
          }}>
            <Icon name="check" size={14} /> {t.cta}
          </button>
        </div>
      </div>

      {/* Strip of secondary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {t.strip.map((s, i) => (
          <div key={i} style={{
            background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
            borderRadius: 14, padding: "10px 12px",
          }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{s.label}</p>
            <p style={{ margin: "4px 0 2px", fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.015em", fontFeatureSettings: "'tnum' 1" }}>{s.value}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: "var(--ivory-text-3)" }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p style={{ margin: "4px 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.quickHead}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {t.quick.map((q, i) => (
            <div key={i} style={{
              background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{
                width: 38, height: 38, borderRadius: 12,
                background: "hsl(130 42% 20% / 0.08)", color: "var(--primary)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}><Icon name={q.icon} size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ivory-text)" }}>{q.title}</p>
                <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "var(--ivory-text-3)" }}>{q.hint}</p>
              </div>
              <span style={{ color: "var(--ivory-text-3)" }}>
                <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={16} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity feed — timeline rail */}
      <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 16, padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ivory-text)" }}>{t.feedHead}</p>
            <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{t.feedSub}</p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)" }}>{isRtl ? "הכל" : "View all"}</span>
        </div>
        <div style={{ position: "relative", paddingInlineStart: 22 }}>
          <div aria-hidden="true" style={{
            position: "absolute", top: 6, bottom: 6, [isRtl ? "right" : "left"]: 7,
            width: 2, background: "linear-gradient(180deg, var(--ivory-border), transparent)"
          }} />
          {t.feed.map((f, i) => (
            <div key={i} style={{ position: "relative", paddingBottom: i === t.feed.length - 1 ? 0 : 14 }}>
              <span style={{
                position: "absolute", [isRtl ? "right" : "left"]: -22, top: 4,
                width: 16, height: 16, borderRadius: 999,
                background: cBg(f.tone), border: `2px solid ${c(f.tone)}`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ivory-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{f.who} · {f.detail}</p>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap" }}>{f.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.V1Refined = V1Refined;
