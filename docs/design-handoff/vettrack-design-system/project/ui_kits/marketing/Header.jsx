// Marketing — Header. Sticky, blurred, with logo lockup + nav CTA.
function Header() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid hsl(40 12% 81% / 0.6)",
        background: "hsl(45 25% 94% / 0.8)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="container" style={{ maxWidth: 1152, margin: "0 auto", padding: "0 24px", height: 68, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="#" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ width: 40, height: 40, borderRadius: 14, background: "var(--primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 16px -8px rgb(15 31 17 / 0.35)" }}>
            <Icon name="qrCode" size={20} />
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--ivory-text)" }}>VetTrack</div>
            <div style={{ fontSize: 11, color: "var(--ivory-text-3)", fontWeight: 500 }}>ICU Equipment QR Tracking</div>
          </div>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a href="#" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 16, fontSize: 14, fontWeight: 700, background: "var(--primary)", color: "#fff", textDecoration: "none", boxShadow: "0 10px 24px -12px rgb(15 31 17 / 0.45)" }}>
            Sign in <Icon name="arrowRight" size={16} />
          </a>
        </nav>
      </div>
    </header>
  );
}
window.Header = Header;
