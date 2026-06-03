// Marketing — Hero. H1 + subhead + dual CTA + trust strip + walkthrough panel.
function Hero() {
  return (
    <section style={{ position: "relative", padding: "60px 24px 80px" }}>
      {/* Background mesh */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: -1,
        background: `
          radial-gradient(1200px 500px at 15% -10%, hsl(130 42% 20% / 0.12), transparent 55%),
          radial-gradient(900px 420px at 85% 5%, hsl(152 40% 45% / 0.08), transparent 50%),
          linear-gradient(180deg, hsl(42 18% 91% / 0.5) 0%, transparent 100%)
        `,
      }} />
      <div style={{ maxWidth: 1152, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 64, alignItems: "start" }}>
        <div>
          <h1 style={{ fontSize: "clamp(36px, 4vw + 1rem, 60px)", lineHeight: 1.05, letterSpacing: "-0.025em", fontWeight: 800, color: "var(--ivory-text)", marginBottom: 24, textWrap: "balance" }}>
            Find Critical Equipment in Seconds <span style={{ color: "var(--primary)" }}>— Not Minutes</span>
          </h1>
          <p style={{ fontSize: 20, lineHeight: 1.5, color: "var(--ivory-text-3)", maxWidth: 540, marginBottom: 32 }}>
            VetTrack is ready for real ICU use. Log in and start tracking equipment immediately.
          </p>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 28px", height: 52, borderRadius: 16, fontWeight: 800, background: "var(--primary)", color: "#fff", border: 0, boxShadow: "0 10px 24px -12px rgb(15 31 17 / 0.45)", cursor: "pointer", fontSize: 15 }}>
              <Icon name="scan" size={18} /> Enter VetTrack System
            </button>
            <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 28px", height: 52, borderRadius: 16, fontWeight: 800, background: "var(--ivory-surface)", color: "var(--ivory-text)", border: "1px solid var(--ivory-border)", cursor: "pointer", fontSize: 15 }}>
              <Icon name="play" size={18} /> Watch 2-Minute Walkthrough
            </button>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { icon: "checkCircle", color: "#16a34a", text: "Secure login · Real-time data · No installation required" },
              { icon: "smartphone", color: "var(--primary)", text: "Add VetTrack to your home screen for faster access" },
              { icon: "sparkles", color: "var(--primary)", text: "Designed for use during active ICU shifts" },
            ].map((row, i) => (
              <li key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ivory-text-3)" }}>
                <span style={{ color: row.color, display: "inline-flex" }}><Icon name={row.icon} size={16} /></span>
                {row.text}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--ivory-text)", marginBottom: 16 }}>First time? Watch this before you start</h2>
          <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", boxShadow: "0 24px 80px -32px rgba(0,0,0,0.25)" }}>
            <div style={{
              position: "relative", aspectRatio: "16/9", width: "100%",
              background: "linear-gradient(135deg, hsl(130 42% 20%) 0%, hsl(125 38% 28%) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                position: "absolute", inset: 0, opacity: 0.18,
                background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 50%), radial-gradient(circle at 70% 70%, rgba(76,222,106,0.5), transparent 50%)"
              }} />
              <button style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "var(--primary)", color: "#fff", border: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 16px 40px -8px rgba(0,0,0,0.5)", cursor: "pointer",
                position: "relative",
              }}>
                <Icon name="play" size={28} />
              </button>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--ivory-text-3)", marginTop: 12 }}>
            Used by ICU teams to reduce equipment search time by up to 70%
          </p>
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
