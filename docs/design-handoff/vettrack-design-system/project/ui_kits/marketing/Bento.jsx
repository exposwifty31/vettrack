// Marketing — Bento feature grid (mirrors landing.tsx layout).
function Bento() {
  const tiles = [
    { span: 3, big: true, icon: "qrCode", tint: { bg: "hsl(130 42% 20% / 0.1)", fg: "var(--primary)" }, title: "Scan-first equipment tracking", body: "Tap any QR or NFC tag to log location, status, and the team member responsible. One scan replaces a clipboard and a radio call." },
    { span: 3, big: true, icon: "wifiOff", tint: { bg: "hsl(38 92% 50% / 0.1)", fg: "#d97706" }, title: "Offline-first when the basement drops signal", body: "Everything captured during a dead-zone shift queues up and syncs the moment connectivity returns. No lost work, no surprises." },
    { span: 2, big: false, icon: "bell", tint: { bg: "hsl(0 72% 51% / 0.1)", fg: "#dc2626" }, title: "Smart alerts", body: "Configurable severity and pool routing — admission doctor pool, ward, senior shift — without paging the wrong team." },
    { span: 2, big: false, icon: "mapPin", tint: { bg: "hsl(130 42% 20% / 0.1)", fg: "var(--primary)" }, title: "Room-level lookup", body: "Filter by room or device class, see what's checked out and by whom, jump to a working device in seconds." },
    { span: 2, big: false, icon: "barChart", tint: { bg: "hsl(142 76% 36% / 0.12)", fg: "#16a34a" }, title: "Shift KPI dashboards", body: "Compare against your 14-day pre-go-live baseline. Adoption + outcome metrics, no separate BI tool." },
    { span: 3, big: false, icon: "package", tint: { bg: "var(--ivory-bg)", fg: "var(--ivory-text)" }, title: "Inventory & dispense reconciliation", body: "Cabinet dispenses cross-checked against active medication orders. Orphan usage surfaces immediately, never silently." },
    { span: 3, big: false, icon: "shield", tint: { bg: "var(--ivory-bg)", fg: "var(--ivory-text)" }, title: "Audit-grade history", body: "Every scan, edit, and dispense is appended to an immutable audit log. Clinic-scoped, encrypted at rest." },
  ];
  return (
    <section style={{ padding: "60px 24px 80px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 56px" }}>
          <p className="kicker">Our Platform</p>
          <h2 style={{ fontSize: 40, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.025em", marginTop: 14, marginBottom: 14, lineHeight: 1.1 }}>
            Built for the way ICU shifts actually work
          </h2>
          <p style={{ fontSize: 18, color: "var(--ivory-text-3)", lineHeight: 1.6, margin: 0 }}>
            Seven surfaces, one product. None of them feel like they were bolted on later.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 18 }}>
          {tiles.map((t, i) => (
            <article key={i} style={{
              gridColumn: `span ${t.span}`,
              borderRadius: t.big ? 24 : 16,
              border: "1px solid hsl(40 12% 81% / 0.7)",
              background: t.big ? "linear-gradient(135deg, var(--ivory-surface), hsl(0 0% 100% / 0.5))" : "var(--ivory-surface)",
              padding: t.big ? 32 : 24,
              boxShadow: t.big ? "0 1px 2px 0 rgb(15 23 42 / 0.05)" : "none",
            }}>
              <div style={{
                width: t.big ? 48 : 40, height: t.big ? 48 : 40, borderRadius: t.big ? 16 : 12,
                background: t.tint.bg, color: t.tint.fg,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                marginBottom: 20,
              }}>
                <Icon name={t.icon} size={t.big ? 24 : 20} />
              </div>
              <h3 style={{ fontSize: t.big ? 20 : 16, fontWeight: 700, color: "var(--ivory-text)", marginBottom: 8, lineHeight: 1.3 }}>{t.title}</h3>
              <p style={{ fontSize: t.big ? 15 : 13.5, color: "var(--ivory-text-3)", lineHeight: 1.6, margin: 0 }}>{t.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
window.Bento = Bento;
