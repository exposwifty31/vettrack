// App — Reusable building blocks.
function Card({ children, style, ...rest }) {
  return (
    <div {...rest} style={{
      background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
      borderRadius: 16, boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
      ...style,
    }}>{children}</div>
  );
}

function KpiCard({ title, value, sub, icon, tint }) {
  const t = tint || "neutral";
  const tintMap = {
    neutral: { bg: "var(--ivory-bg)",         border: "var(--ivory-border)", fg: "var(--ivory-text-2)" },
    primary: { bg: "hsl(130 42% 20% / 0.1)",  border: "hsl(130 42% 20% / 0.2)", fg: "var(--primary)" },
    warn:    { bg: "hsl(38 92% 50% / 0.1)",   border: "hsl(38 92% 50% / 0.25)", fg: "#d97706" },
    err:     { bg: "hsl(0 72% 51% / 0.08)",   border: "hsl(0 72% 51% / 0.2)", fg: "#dc2626" },
    ok:      { bg: "hsl(142 76% 36% / 0.1)",  border: "hsl(142 76% 36% / 0.25)", fg: "#16a34a" },
  }[t];
  return (
    <Card style={{ padding: 14, minHeight: 120, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ivory-text-3)" }}>{title}</span>
        <span style={{ width: 30, height: 30, borderRadius: 10, border: `1px solid ${tintMap.border}`, background: tintMap.bg, color: tintMap.fg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ivory-text)", lineHeight: 1, fontFeatureSettings: "'tnum' 1", letterSpacing: "-0.015em" }}>{value}</div>
        <div style={{ fontSize: 11, color: "var(--ivory-text-3)", marginTop: 4 }}>{sub}</div>
      </div>
    </Card>
  );
}

function StatusPill({ status }) {
  const cfg = {
    Operational:     { bg: "#f0faf2", fg: "#166534", border: "#a7f3bd", dot: "#16a34a" },
    "Due Check":     { bg: "#fffbeb", fg: "#78350f", border: "#fcd34d", dot: "#d97706" },
    "Review Needed": { bg: "#fff1f1", fg: "#7f1d1d", border: "#fca5a5", dot: "#dc2626" },
    Sterilized:      { bg: "#eff6ff", fg: "#1e40af", border: "#93c5fd", dot: "#2563eb" },
    Maintenance:     { bg: "#fffbeb", fg: "#78350f", border: "#fcd34d", dot: "#d97706" },
  }[status] || { bg: "#f5f5f5", fg: "#555", border: "#ddd", dot: "#aaa" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 4, border: `1px solid ${cfg.border}`,
      background: cfg.bg, color: cfg.fg,
      fontSize: 11, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: cfg.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

window.Card = Card;
window.KpiCard = KpiCard;
window.StatusPill = StatusPill;
