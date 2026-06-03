// Marketing — How it works (3 steps) + Quote + Final CTA + Footer
function HowSteps() {
  const steps = [
    { n: "01", icon: "qrCode", title: "Print + stick QR labels", body: "Order printed sheets or generate codes from any browser. Stick once, scan forever." },
    { n: "02", icon: "scan", title: "Scan during the shift", body: "Each scan logs status, location, the team member, and timestamp. PWA installs to home screen." },
    { n: "03", icon: "fileText", title: "Hand off + report", body: "Structured handoffs at shift change, monthly PDF reports for management, audit log on demand." },
  ];
  return (
    <section style={{ padding: "72px 24px", background: "hsl(42 18% 91% / 0.35)", borderTop: "1px solid hsl(40 12% 81% / 0.5)", borderBottom: "1px solid hsl(40 12% 81% / 0.5)" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 56px" }}>
          <p className="kicker">How It Works</p>
          <h2 style={{ fontSize: 40, fontWeight: 700, color: "var(--ivory-text)", letterSpacing: "-0.025em", marginTop: 14, marginBottom: 14, lineHeight: 1.1 }}>
            From sticker to KPI dashboard in three days
          </h2>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
          <div aria-hidden="true" style={{ position: "absolute", top: 40, left: "16%", right: "16%", height: 2, background: "hsl(40 12% 81% / 0.8)", zIndex: 0 }} />
          {steps.map(s => (
            <div key={s.n} style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 16px 32px -16px rgb(15 31 17 / 0.5)", marginBottom: 20 }}>
                <Icon name={s.icon} size={28} />
              </div>
              <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--ivory-text-3)", marginBottom: 6 }}>Step {s.n}</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: "var(--ivory-text)", marginBottom: 8 }}>{s.title}</p>
              <p style={{ fontSize: 14, color: "var(--ivory-text-3)", lineHeight: 1.6, maxWidth: 280, margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quote() {
  return (
    <section style={{ padding: "80px 24px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{
          position: "relative", borderRadius: 28, padding: 48,
          border: "1px solid hsl(40 12% 81% / 0.6)", background: "hsl(0 0% 100% / 0.6)",
          backdropFilter: "blur(6px)",
          boxShadow: "0 24px 80px -32px rgba(0,0,0,0.25)",
        }}>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 28, background: "linear-gradient(135deg, hsl(130 42% 20% / 0.06), transparent 60%)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 2, marginBottom: 24, color: "#f59e0b" }}>
              {[0,1,2,3,4].map(i => <Icon key={i} name="star" size={20} />)}
            </div>
            <blockquote style={{ margin: 0 }}>
              <p style={{ fontSize: 24, fontWeight: 500, color: "var(--ivory-text)", lineHeight: 1.4, textWrap: "balance", marginBottom: 24, textAlign: "center" }}>
                Equipment used to vanish between shifts. Now we open the app, see what's where, and start working. No clipboards. No radio calls.
              </p>
              <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <cite style={{ fontStyle: "normal", fontWeight: 600, color: "var(--ivory-text)" }}>Dr. Maya Eldar</cite>
                  <p style={{ fontSize: 13, color: "var(--ivory-text-3)", margin: "2px 0 0" }}>Head of ICU, Tel Aviv Veterinary</p>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ivory-text-3)" }}>
                  <Icon name="building" size={14} /> Multi-site clinic
                </div>
              </footer>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section style={{ position: "relative", padding: "100px 24px", color: "#fff", overflow: "hidden" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "var(--primary)" }} />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, opacity: 0.4,
        background: "radial-gradient(800px 400px at 20% 20%, white 0%, transparent 50%), radial-gradient(600px 300px at 80% 80%, hsl(200 100% 70% / 0.3) 0%, transparent 55%)",
      }} />
      <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(32px, 3vw + 1rem, 44px)", fontWeight: 800, letterSpacing: "-0.025em", marginBottom: 16, textWrap: "balance" }}>
          Ready to find your equipment in seconds?
        </h2>
        <p style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 40, color: "rgba(255,255,255,0.9)" }}>
          Free for the first clinic. Sign in, install to your home screen, and run a real shift before you decide.
        </p>
        <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 32px", height: 56, borderRadius: 18, fontWeight: 800, background: "var(--ivory-bg)", color: "var(--ivory-text)", border: 0, boxShadow: "0 16px 32px -8px rgba(0,0,0,0.3)", cursor: "pointer", fontSize: 16 }}>
          <Icon name="scan" size={20} /> Enter VetTrack System
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ padding: "44px 24px", borderTop: "1px solid hsl(40 12% 81% / 0.6)", background: "var(--ivory-bg)" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: "var(--primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="qrCode" size={16} />
          </div>
          <div>
            <p style={{ fontWeight: 700, color: "var(--ivory-text)", margin: 0 }}>VetTrack</p>
            <p style={{ fontSize: 13, color: "var(--ivory-text-3)", margin: 0, maxWidth: 360 }}>Veterinary equipment tracking for the ICU. Mobile-first, offline-capable.</p>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 24, fontSize: 14, color: "var(--ivory-text-3)" }}>
          <a href="#" style={{ color: "inherit", textDecoration: "none" }}>App</a>
          <a href="#" style={{ color: "inherit", textDecoration: "none" }}>Equipment</a>
          <a href="#" style={{ color: "inherit", textDecoration: "none" }}>Help</a>
          <a href="#" style={{ color: "inherit", textDecoration: "none" }}>Sign in</a>
        </nav>
      </div>
    </footer>
  );
}

window.HowSteps = HowSteps;
window.Quote = Quote;
window.FinalCta = FinalCta;
window.Footer = Footer;
