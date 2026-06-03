// EquipmentScreenPro — the hybrid: v2 list mechanics (sticky section headers,
// mono meta, 3px status edge-bar, flat borderless rows, mono stat strip) +
// v4 triage ordering (Needs attention → In use → Operational). Fully tokenized.
// Numerics (IDs, times, counts) use --font-num (DM Mono) per the system rule.
const NUM = { fontFamily: "var(--font-num)" };

function EquipmentScreenPro({ dir = "ltr", onScan, onOpen }) {
  const isRtl = dir === "rtl";
  const { useState: us, useMemo: um } = React;
  const [filter, setFilter] = us("all");

  // status: err (review) · warn (due/maint) · use (in use) · ok (operational)
  const all = [
    { id: "DEF-0492", name: isRtl ? "דפיברילטור" : "Defibrillator",        loc: "OR 3",  status: "err",  pill: isRtl ? "בדיקה באיחור" : "Check overdue", time: "9d",  detail: isRtl ? "בדיקה לפני 9 ימים" : "Last check 9 days ago" },
    { id: "CART-C2", name: isRtl ? "עגלת חירום C-2" : "Crash Cart C-2",     loc: "ER",    status: "err",  pill: isRtl ? "חוסר מלאי" : "Stock missing",  time: "5m",  detail: isRtl ? "אדרנלין — 0 ביחידה" : "Epinephrine — 0 left" },
    { id: "VENT-08", name: isRtl ? "מנשם Hamilton C1" : "Ventilator C1",    loc: "ICU 1", status: "warn", pill: isRtl ? "תחזוקה" : "Maintenance",     time: "2d",  detail: isRtl ? "מתוזמן · 4 ביוני" : "Scheduled · 4 Jun" },
    { id: "SP-201",  name: isRtl ? "משאבת מזרק" : "Syringe Pump",           loc: "ICU 2", status: "warn", pill: isRtl ? "כיול חודשי" : "Due cal.",       time: "1d",  detail: isRtl ? "כיול חודשי בקרוב" : "Monthly cal. due" },
    { id: "ECG-118", name: isRtl ? "מוניטור ECG uMEC10" : "ECG Monitor uMEC10", loc: "ICU 1", status: "use", pill: isRtl ? "בלה · לאב" : "Bella · Lab", time: "2m", detail: isRtl ? "בשימוש מטופל" : "In patient use" },
    { id: "SP-118",  name: isRtl ? "משאבת מזרק" : "Syringe Pump",           loc: "ICU 2", status: "use",  pill: isRtl ? "לוקי · DSH" : "Loki · DSH",   time: "23m", detail: isRtl ? "בשימוש מטופל" : "In patient use" },
    { id: "MON-44",  name: isRtl ? "מוניטור רב-פרמטרי" : "Multiparam Monitor", loc: "OR 1", status: "ok", pill: isRtl ? "פעיל" : "Ready",            time: "1h",  detail: "" },
    { id: "IVP-03",  name: isRtl ? "משאבת עירוי" : "Infusion Pump",         loc: "ICU 3", status: "ok",   pill: isRtl ? "פעיל" : "Ready",            time: "1h",  detail: "" },
    { id: "WARM-02", name: isRtl ? "מחמם מטופל" : "Patient Warmer",         loc: "OR 2",  status: "ok",   pill: isRtl ? "פעיל" : "Ready",            time: "3h",  detail: "" },
    { id: "ANES-01", name: isRtl ? "תחנת הרדמה" : "Anesthesia Station",     loc: "OR 3",  status: "ok",   pill: isRtl ? "פעיל" : "Ready",            time: "3h",  detail: "" },
  ];

  const counts = um(() => ({
    total: all.length,
    attention: all.filter(e => e.status === "err" || e.status === "warn").length,
    use: all.filter(e => e.status === "use").length,
    ok: all.filter(e => e.status === "ok").length,
  }), []);

  const visible = filter === "all" ? all : all.filter(e =>
    filter === "attention" ? (e.status === "err" || e.status === "warn") : e.status === filter
  );

  // Triage ordering: err → warn → use → ok
  const order = { err: 0, warn: 1, use: 2, ok: 3 };
  const sorted = [...visible].sort((a, b) => order[a.status] - order[b.status]);

  // Group into sections
  const sections = [
    { key: "attn", label: isRtl ? "דורש טיפול" : "Needs attention", rows: sorted.filter(e => e.status === "err" || e.status === "warn") },
    { key: "use",  label: isRtl ? "בשימוש" : "In use",             rows: sorted.filter(e => e.status === "use") },
    { key: "ok",   label: isRtl ? "תקין" : "Operational",          rows: sorted.filter(e => e.status === "ok") },
  ].filter(s => s.rows.length > 0);

  const barColor = { err: "var(--status-issue)", warn: "var(--status-maintenance)", use: "var(--brand)", ok: "#4A9B6A" };
  const pillStyle = {
    err:  { background: "var(--status-issue-bg)", color: "var(--status-issue-fg)" },
    warn: { background: "var(--status-maint-bg)", color: "var(--status-maint-fg)" },
    use:  { background: "var(--brand-soft)",      color: "var(--brand-ink)" },
    ok:   { background: "var(--action-soft)",     color: "var(--action-ink)" },
  };

  const filters = [
    { k: "all",       label: isRtl ? "הכל" : "All",            n: counts.total },
    { k: "attention", label: isRtl ? "דורש טיפול" : "Attention", n: counts.attention, tone: "err" },
    { k: "use",       label: isRtl ? "בשימוש" : "In use",      n: counts.use },
    { k: "ok",        label: isRtl ? "תקין" : "Operational",   n: counts.ok },
  ];

  return (
    <div dir={dir} style={{ background: "var(--background)", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <style>{`
        .eqp-row { transition: background 0.1s; }
        .eqp-row:active { background: var(--ivory-bg); }
        .eqp-sec { position: sticky; top: 0; z-index: 5; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "10px 18px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.02em" }}>{isRtl ? "ציוד" : "Equipment"}</h1>
          <button onClick={onScan} style={{
            height: 34, padding: "0 13px", borderRadius: 9, border: 0, cursor: "pointer",
            background: "var(--brand)", color: "#fff", fontFamily: "var(--font-sans)",
            fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
          }}><Icon name="scanLine" size={15} /> {isRtl ? "סרוק" : "Scan"}</button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "0 18px 10px" }}>
        <div style={{
          height: 38, background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
          borderRadius: 9, display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
        }}>
          <Icon name="search" size={15} className="" />
          <span style={{ fontSize: 13, color: "var(--ivory-text-3)" }}>{isRtl ? "חיפוש לפי שם, מזהה, חדר…" : "Search name, ID, room…"}</span>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, padding: "0 18px 12px", overflowX: "auto" }}>
        {filters.map(f => {
          const on = filter === f.k;
          return (
            <button key={f.k} onClick={() => setFilter(f.k)} style={{
              flexShrink: 0, padding: "5px 11px", borderRadius: 7, cursor: "pointer",
              fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
              border: `1px solid ${on ? "var(--brand)" : "var(--ivory-border)"}`,
              background: on ? "var(--brand)" : "var(--ivory-surface)",
              color: on ? "#fff" : "var(--ivory-text-2)",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              {f.label}
              <span style={{ ...NUM, fontSize: 11, opacity: on ? 0.85 : 0.6 }}>{f.n}</span>
            </button>
          );
        })}
      </div>

      {/* Stat strip */}
      <div style={{ display: "flex", gap: 8, padding: "0 18px 14px" }}>
        {[
          { v: counts.total, l: isRtl ? "סה״כ" : "Total",     tone: "" },
          { v: counts.attention, l: isRtl ? "דורש טיפול" : "Attention", tone: "err" },
          { v: counts.use, l: isRtl ? "בשימוש" : "In use",   tone: "" },
          { v: `${Math.round(counts.ok / counts.total * 100)}%`, l: isRtl ? "זמינות" : "Uptime", tone: "ok" },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
            borderRadius: 10, padding: "9px 11px",
          }}>
            <div style={{ ...NUM, fontSize: 19, fontWeight: 500, letterSpacing: "-0.5px", lineHeight: 1,
              color: s.tone === "err" ? "var(--status-issue)" : s.tone === "ok" ? "var(--action-ink)" : "var(--ivory-text)" }}>{s.v}</div>
            <div style={{ fontSize: 9.5, color: "var(--ivory-text-3)", marginTop: 4, letterSpacing: "0.2px", whiteSpace: "nowrap" }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Triage list */}
      <div style={{ flex: 1, paddingBottom: 12 }}>
        {sections.map(sec => (
          <div key={sec.key}>
            <div className="eqp-sec" style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 18px 6px",
              background: "var(--background)",
            }}>
              {sec.key === "attn" && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--status-issue)", flexShrink: 0 }} />}
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: sec.key === "attn" ? "var(--status-issue)" : "var(--ivory-text-3)" }}>{sec.label}</span>
              <span style={{ flex: 1, height: 1, background: "var(--ivory-border)" }} />
              <span style={{ ...NUM, fontSize: 10, color: "var(--ivory-text-3)" }}>{String(sec.rows.length).padStart(2, "0")}</span>
            </div>
            {sec.rows.map(eq => (
              <div key={eq.id} className="eqp-row" onClick={() => onOpen && onOpen(eq)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
                borderBottom: "1px solid var(--ivory-border)", cursor: "pointer",
              }}>
                <div style={{ width: 3, height: 38, borderRadius: 2, flexShrink: 0, background: barColor[eq.status] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.2px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{eq.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, minWidth: 0 }}>
                    <span style={{ ...NUM, fontSize: 11, color: "var(--ivory-text-3)", whiteSpace: "nowrap", flexShrink: 0 }}>{eq.id}</span>
                    <span style={{ width: 2, height: 2, borderRadius: 999, background: "var(--ivory-text-3)", opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "var(--ivory-text-3)", whiteSpace: "nowrap", flexShrink: 0 }}>{eq.loc}</span>
                    {eq.detail && (eq.status === "err" || eq.status === "warn") && (
                      <>
                        <span style={{ width: 2, height: 2, borderRadius: 999, background: "var(--ivory-text-3)", opacity: 0.5 }} />
                        <span style={{ fontSize: 11, color: eq.status === "err" ? "var(--status-issue)" : "var(--status-maintenance)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{eq.detail}</span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: isRtl ? "flex-start" : "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.1px", whiteSpace: "nowrap", ...pillStyle[eq.status] }}>{eq.pill}</span>
                  <span style={{ ...NUM, fontSize: 10, color: "var(--ivory-text-3)", whiteSpace: "nowrap" }}>{eq.time}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
window.EquipmentScreenPro = EquipmentScreenPro;
