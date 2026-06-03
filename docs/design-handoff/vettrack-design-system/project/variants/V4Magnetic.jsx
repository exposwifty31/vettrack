// V4 Magnetic — refined. Mature clinical palette, one-handed thumb zone.
// Glance content at top (greeting / rings / streak). Action in thumb zone (Next-up card with 60px CTA).
// Color discipline: matte forest hero · single restrained amber for the streak · 2-tone green for actions.
const { useState: __u, useEffect: __e } = React;

function CountUp({ to, duration = 900, suffix = "" }) {
  const [n, setN] = __u(0);
  __e(() => {
    let raf, start;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{n}{suffix}</>;
}

function ShiftRings({ data }) {
  const cx = 110, cy = 110;
  const C = (r) => 2 * Math.PI * r;
  const arc = (r, pct, color, stroke = 11) => {
    const c = C(r);
    return (
      <circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c * (1 - pct)}`}
        strokeDashoffset={c * 0.25}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 1100ms cubic-bezier(0.34,1.56,0.64,1)" }}
      />
    );
  };
  const bg = (r, stroke = 11) => (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
  );
  return (
    <svg viewBox="0 0 220 220" width="160" height="160" aria-hidden="true">
      {bg(86)}{arc(86, data[0].pct, data[0].color)}
      {bg(68)}{arc(68, data[1].pct, data[1].color)}
      {bg(50)}{arc(50, data[2].pct, data[2].color)}
    </svg>
  );
}

function V4Magnetic({ dir = "ltr", strings }) {
  const isRtl = dir === "rtl";
  const t = strings || {
    chipDate: "Sun · 4 May · ICU",
    hello: "Hey Maya,",
    sub: "5h 12m left in this shift. You've got this.",
    heroKicker: "Your shift",
    rings: [
      { label: "Tasks",    pct: 8/12, n: 8,  of: 12, color: "#34d399" }, // emerald
      { label: "Scans",    pct: 0.78, n: 23, of: 30, color: "#a8b5b0" }, // sage-stone
      { label: "Patients", pct: 18/18,n: 18, of: 18, color: "#e0b87a" }, // warm honey
    ],
    progress: "67% complete",
    streakKicker: "Streak · 5 shifts",
    streakTitle: "No overdue checks. Keep it.",
    nextKicker: "Next up",
    nextTitle: "Sterilize crash cart C-2",
    nextBody: "Epinephrine restock · 12 min away",
    nextCta: "Start now",
    quickHead: "Or",
    quick: [
      { icon: "scan",        title: "Scan equipment", hint: "QR or NFC",   tone: "solid" },
      { icon: "shieldAlert", title: "Triage alerts",  hint: "3 to review", tone: "soft"  },
    ],
    pulse: "Just now",
    pulseText: "Daniel returned SP-118 to ICU 2",
    feedHead: "Today",
    feed: [
      { name: "Sterilization queued · EQ-0492", time: "1h" },
      { name: "Cart C-2 needs epinephrine",     time: "1h" },
      { name: "ECG monitor scan · ICU 1",       time: "2h" },
    ],
  };

  return (
    <div dir={dir} style={{
      padding: "8px 14px 110px",
      background: "linear-gradient(180deg, #f4f3ed 0%, #f8f7f1 36%, var(--background) 100%)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <style>{`
        @keyframes magneticPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(5,150,105,0.45); }
          70% { box-shadow: 0 0 0 12px rgba(5,150,105,0); }
        }
        @keyframes magneticFadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .m-fade { animation: magneticFadeUp 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      `}</style>

      {/* Greeting — glance only */}
      <div className="m-fade" style={{ paddingTop: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "3px 9px", borderRadius: 999,
          background: "rgba(15,31,17,0.05)", color: "var(--ivory-text-2)",
          fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: "#059669" }} />
          {t.chipDate}
        </span>
        <h1 style={{
          margin: "10px 0 4px", fontSize: 30, fontWeight: 700,
          color: "var(--ivory-text)", letterSpacing: "-0.025em", lineHeight: 1.08,
        }}>{t.hello}</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ivory-text-3)", lineHeight: 1.4 }}>{t.sub}</p>
      </div>

      {/* Hero rings — matte, restrained, more compact */}
      <div className="m-fade" style={{
        position: "relative", overflow: "hidden",
        borderRadius: 24, padding: "16px 18px 18px",
        background: "radial-gradient(circle at 78% -10%, rgba(52,211,153,0.10), transparent 55%), linear-gradient(155deg, #0a1f15 0%, #122c1f 70%, #1a3d28 100%)",
        color: "#fff",
        boxShadow: "0 18px 36px -20px rgba(10,31,21,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{t.heroKicker}</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 9px", borderRadius: 999,
            background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)",
            fontSize: 10.5, fontWeight: 600, fontFeatureSettings: "'tnum' 1", letterSpacing: "0.02em",
          }}>
            <span style={{ width: 4, height: 4, borderRadius: 999, background: "#34d399" }} />
            {t.progress}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ flexShrink: 0, marginInlineStart: -6 }}>
            <ShiftRings data={t.rings} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {t.rings.map((r, i) => (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.82)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: r.color }} />
                    {r.label}
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", fontFeatureSettings: "'tnum' 1", letterSpacing: "0.01em" }}>
                    <span style={{ color: "#fff", fontWeight: 600 }}><CountUp to={r.n} duration={900 + i * 150} /></span>
                    <span style={{ opacity: 0.55 }}> / {r.of}</span>
                  </span>
                </div>
                <div style={{ marginTop: 5, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{
                    width: `${r.pct * 100}%`, height: "100%", background: r.color,
                    borderRadius: 999, transition: "width 1100ms cubic-bezier(0.34,1.56,0.64,1)",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Streak — restrained ochre, no glossy orb */}
      <div className="m-fade" style={{
        position: "relative",
        borderRadius: 16, padding: "12px 14px",
        background: "linear-gradient(135deg, #fbf7eb 0%, #f5edd6 100%)",
        border: "1px solid #ead9b0",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: "#1a3d28", color: "#e0b87a",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          boxShadow: "inset 0 0 0 1px rgba(224,184,122,0.4)",
        }}>5</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#92400e" }}>{t.streakKicker}</p>
          <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: "#1c2a18", letterSpacing: "-0.005em" }}>{t.streakTitle}</p>
        </div>
      </div>

      {/* NEXT UP — the thumb-zone hero. Big tappable CTA. */}
      <div className="m-fade" style={{
        position: "relative", overflow: "hidden",
        borderRadius: 20, padding: "16px 16px 14px",
        background: "var(--ivory-surface)",
        border: "1px solid var(--ivory-border)",
        boxShadow: "0 1px 2px rgb(15 23 42 / 0.04), 0 16px 28px -16px rgb(15 23 42 / 0.18)",
      }}>
        <div aria-hidden="true" style={{
          position: "absolute", insetInlineStart: 0, top: 14, bottom: 14, width: 3,
          background: "linear-gradient(180deg, #1a3d28, #2d6b45)", borderRadius: 999,
        }} />
        <div style={{ paddingInlineStart: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#1a3d28" }}>{t.nextKicker}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 999,
              background: "#fef3c7", color: "#92400e",
              fontSize: 10.5, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
            }}>
              <Icon name="clock" size={10} />
              12 min
            </span>
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.015em", lineHeight: 1.25 }}>{t.nextTitle}</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ivory-text-3)", lineHeight: 1.4 }}>{t.nextBody}</p>
          <button style={{
            width: "100%", height: 60, borderRadius: 16, border: 0,
            background: "linear-gradient(135deg, #1a3d28 0%, #2d6b45 100%)", color: "#fff",
            fontSize: 15, fontWeight: 700, fontFamily: "var(--font-sans)", letterSpacing: "-0.005em", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
            boxShadow: "0 10px 22px -10px rgba(26,61,40,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}>
            {t.nextCta}
            <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={18} />
          </button>
        </div>
      </div>

      {/* Or — secondary actions, 2-tone */}
      <div className="m-fade">
        <p style={{ margin: "2px 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.quickHead}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {t.quick.map((q, i) => {
            const tones = {
              solid: { bg: "#1a3d28",                 fg: "#fff",            hint: "rgba(255,255,255,0.65)", iconBg: "rgba(255,255,255,0.14)", iconFg: "#fff",        border: "transparent"   },
              soft:  { bg: "var(--ivory-surface)",    fg: "var(--ivory-text)", hint: "var(--ivory-text-3)",  iconBg: "#eef0ea",               iconFg: "#1a3d28",     border: "var(--ivory-border)" },
            }[q.tone] || {};
            return (
              <button key={i} style={{
                padding: 14, borderRadius: 16, cursor: "pointer",
                background: tones.bg, color: tones.fg, border: `1px solid ${tones.border}`,
                textAlign: isRtl ? "right" : "left",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                minHeight: 76,
                boxShadow: q.tone === "solid"
                  ? "0 10px 22px -12px rgba(26,61,40,0.45)"
                  : "0 1px 2px rgb(15 23 42 / 0.04)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.005em" }}>{q.title}</div>
                  <div style={{ fontSize: 11, color: tones.hint, marginTop: 2 }}>{q.hint}</div>
                </div>
                <span style={{
                  width: 36, height: 36, borderRadius: 11,
                  background: tones.iconBg, color: tones.iconFg,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}><Icon name={q.icon} size={17} /></span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fresh event — soft pulse */}
      <div className="m-fade" style={{
        background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
        borderRadius: 14, padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: "#059669", flexShrink: 0,
          animation: "magneticPulse 2.2s ease-out infinite",
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#047857" }}>{t.pulse}</p>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ivory-text)" }}>{t.pulseText}</p>
        </div>
      </div>

      {/* Today list */}
      <div className="m-fade">
        <p style={{ margin: "2px 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ivory-text-3)" }}>{t.feedHead}</p>
        <div style={{ background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)", borderRadius: 14, overflow: "hidden" }}>
          {t.feed.map((f, i) => (
            <div key={i} style={{
              padding: "11px 14px",
              borderBottom: i === t.feed.length - 1 ? "none" : "1px solid hsl(40 12% 81% / 0.5)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{f.name}</p>
              <span style={{ fontSize: 10.5, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap" }}>{f.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.V4Magnetic = V4Magnetic;
