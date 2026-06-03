// V4 Pro — token-driven. Consumes theme CSS vars so Forest / Clinical / Dark swap cleanly.
// 60% surface/bg · 30% --brand (nav, headers, primary task CTA, progress) · 10% --action (scan/confirm).
const { useState: _pu, useEffect: _pe } = React;

function ProCount({ to, duration = 850, suffix = "" }) {
  const [n, setN] = _pu(0);
  _pe(() => {
    let raf, start;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{n}{suffix}</>;
}

function ProRing({ pct, size = 92 }) {
  const r = 40, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke="var(--action)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} strokeDashoffset={c * 0.25}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dasharray 1100ms cubic-bezier(0.34,1.56,0.64,1)" }}
      />
    </svg>
  );
}

function V4Pro({ dir = "ltr", strings }) {
  const isRtl = dir === "rtl";
  const t = strings || {
    hello: "Good afternoon, Maya",
    sub: "ICU · 5h 12m left",
    readyLabel: "Ward readiness",
    progressLabel: "Shift progress",
    progressPct: 0.67,
    progressNum: "67%",
    stats: [
      { label: "Tasks",    val: "8/12" },
      { label: "Scans",    val: "23" },
      { label: "On-time",  val: "98%" },
    ],
    wins: ["Crash cart ready", "No overdue checks"],
    nextKicker: "Next up",
    nextEta: "12 min",
    nextTitle: "Sterilize crash cart C-2",
    nextBody: "Epinephrine restock, then run the sterilization cycle.",
    nextCta: "Start now",
    scanCta: "Scan equipment",
    feedHead: "Earlier today",
    feed: [
      { name: "Daniel returned SP-118", room: "ICU 2", time: "23m" },
      { name: "EQ-0492 queued for sterilization", room: "OR 3", time: "1h" },
      { name: "ECG monitor scanned", room: "ICU 1", time: "2h" },
    ],
    feedView: "View all activity",
  };

  return (
    <div dir={dir} style={{
      padding: "12px 16px 110px",
      background: "var(--background)",
      display: "flex", flexDirection: "column", gap: 18,
    }}>
      <style>{`
        @keyframes proRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .pro-rise { animation: proRise 620ms cubic-bezier(0.2,0.8,0.2,1) both; }
        .pro-rise:nth-child(1){animation-delay:0ms}
        .pro-rise:nth-child(2){animation-delay:70ms}
        .pro-rise:nth-child(3){animation-delay:140ms}
        .pro-rise:nth-child(4){animation-delay:210ms}
        .pro-rise:nth-child(5){animation-delay:280ms}
      `}</style>

      {/* ZONE 1 — GLANCE */}
      <div className="pro-rise" style={{ paddingTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.02em", lineHeight: 1.15 }}>{t.hello}</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ivory-text-3)", letterSpacing: "0.01em" }}>{t.sub}</p>
      </div>

      <div className="pro-rise" style={{
        borderRadius: 18, padding: "18px 18px",
        background: "linear-gradient(155deg, var(--hero-a) 0%, var(--hero-b) 100%)",
        color: "#fff",
        display: "flex", alignItems: "center", gap: 18,
      }}>
        <div style={{ position: "relative", flexShrink: 0, width: 92, height: 92, display: "grid", placeItems: "center" }}>
          <ProRing pct={t.progressPct} />
          <span style={{ position: "absolute", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", fontFamily: "var(--font-num)", whiteSpace: "nowrap" }}>{t.progressNum}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: "0 0 12px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{t.progressLabel}</p>
          <div style={{ display: "flex", gap: 16 }}>
            {t.stats.map((s, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", fontFamily: "var(--font-num)", whiteSpace: "nowrap" }}>{s.val}</div>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", marginTop: 2, whiteSpace: "nowrap" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Micro-wins — tiny completion badges */}
      <div className="pro-rise" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -6 }}>
        {t.wins.map((w, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 11px", borderRadius: 999,
            background: "var(--action-soft)", color: "var(--action-ink)", border: "1px solid var(--action-border)",
            fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
          }}>
            <Icon name="check" size={12} /> {w}
          </span>
        ))}
      </div>

      {/* ZONE 2 — REACH */}
      <div className="pro-rise" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          borderRadius: 18, padding: "16px 18px",
          background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
          boxShadow: "0 1px 2px rgb(15 23 42 / 0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--brand)" }}>{t.nextKicker}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 999, background: "#fef3c7", color: "#8a5a16",
              fontSize: 10.5, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
            }}>
              <Icon name="clock" size={10} /> {t.nextEta}
            </span>
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.02em", lineHeight: 1.22 }}>{t.nextTitle}</h2>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ivory-text-3)", lineHeight: 1.5 }}>{t.nextBody}</p>
          <button style={{
            width: "100%", height: 58, borderRadius: 15, border: 0,
            background: "linear-gradient(135deg, var(--brand) 0%, var(--brand-deep) 100%)", color: "#fff",
            fontSize: 15, fontWeight: 700, fontFamily: "var(--font-sans)", letterSpacing: "-0.005em", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
            boxShadow: "0 8px 20px -10px var(--brand-shadow)",
          }}>
            {t.nextCta}
            <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={18} />
          </button>
        </div>

        <button style={{
          width: "100%", height: 52, borderRadius: 15,
          background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", color: "var(--ivory-text)",
          fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
        }}>
          <Icon name="scanLine" size={17} /> {t.scanCta}
        </button>
      </div>

      {/* ZONE 3 — context list */}
      <div className="pro-rise">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 8px" }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.feedHead}</p>
        </div>
        <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 16, overflow: "hidden" }}>
          {t.feed.map((f, i) => (
            <div key={i} style={{
              padding: "13px 16px",
              borderBottom: i === t.feed.length - 1 ? "none" : "1px solid var(--ivory-border)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ivory-text-3)" }}>{f.room}</p>
              </div>
              <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFamily: "var(--font-num)", whiteSpace: "nowrap" }}>{f.time}</span>
            </div>
          ))}
          <button style={{
            width: "100%", padding: "12px 16px", border: 0, borderTop: "1px solid var(--ivory-border)",
            background: "transparent", color: "var(--brand)", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            {t.feedView}
            <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

window.V4Pro = V4Pro;
