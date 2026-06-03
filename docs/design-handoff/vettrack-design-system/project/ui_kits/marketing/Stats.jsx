// Marketing — Quick-links strip + Stats outcomes
function QuickStrip() {
  const links = ["Scan equipment", "Find by room", "Active alerts", "Shift handoff", "Inventory", "Monthly reports"];
  return (
    <section style={{ borderTop: "1px solid hsl(40 12% 81% / 0.5)", borderBottom: "1px solid hsl(40 12% 81% / 0.5)", background: "hsl(42 18% 91% / 0.4)", padding: "16px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, overflowX: "auto" }}>
        {links.map(l => (
          <span key={l} style={{
            display: "inline-flex", alignItems: "center", padding: "8px 16px",
            borderRadius: 9999, border: "1px solid hsl(40 12% 81% / 0.6)",
            background: "var(--ivory-surface)", fontSize: 13, fontWeight: 500,
            color: "var(--ivory-text)", whiteSpace: "nowrap", boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)"
          }}>{l}</span>
        ))}
      </div>
    </section>
  );
}

function Stats() {
  const stats = [
    { v: "70%", l: "Less time spent searching for critical equipment during active shifts" },
    { v: "100%", l: "Offline-capable — works even when the basement loses signal" },
    { v: "<2 min", l: "Shift handoff time from scan to next team's first task" },
  ];
  return (
    <section style={{ padding: "56px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
        {stats.map(s => (
          <div key={s.v} style={{ borderRadius: 20, border: "1px solid hsl(40 12% 81% / 0.5)", background: "hsl(0 0% 100% / 0.5)", padding: "28px 24px" }}>
            <p style={{ fontSize: 40, fontWeight: 800, color: "var(--primary)", letterSpacing: "-0.025em", margin: "0 0 8px", fontFeatureSettings: "'tnum' 1" }}>{s.v}</p>
            <p style={{ fontSize: 14, color: "var(--ivory-text-3)", lineHeight: 1.5, margin: 0, maxWidth: 280 }}>{s.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
window.QuickStrip = QuickStrip;
window.Stats = Stats;
