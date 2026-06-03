// ScanOverlay — scanner with action→reward. Tap the frame (or "Simulate") to "detect":
// sub-300ms green check + equipment card + live counter bump. Every scan feels complete.
function ScanOverlay({ open, onClose, dir = "ltr", scanCount = 23, onScanned }) {
  const isRtl = dir === "rtl";
  const { useState: us, useEffect: ue } = React;
  const [phase, setPhase] = us("scanning"); // scanning → success

  ue(() => {
    if (!open) { setPhase("scanning"); return; }
  }, [open]);

  ue(() => {
    if (phase !== "success") return;
    onScanned && onScanned();
    const id = setTimeout(onClose, 1900);
    return () => clearTimeout(id);
  }, [phase]);

  if (!open) return null;
  const count = scanCount + (phase === "success" ? 1 : 0);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 100,
      background: "rgba(8, 18, 12, 0.94)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", flexDirection: "column", color: "#fff",
      animation: "scanFade 200ms ease-out",
    }} dir={dir}>
      <style>{`
        @keyframes scanFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scanSweep { 0%, 100% { transform: translateY(0); opacity: 0.9 } 50% { transform: translateY(180px); opacity: 0.4 } }
        @keyframes scanRing { from { stroke-dashoffset: 264 } to { stroke-dashoffset: 0 } }
        @keyframes scanCheck { from { stroke-dashoffset: 30 } to { stroke-dashoffset: 0 } }
        @keyframes scanCardPop { 0% { opacity: 0; transform: translateY(10px) scale(0.97) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes scanCountPop { 0% { transform: scale(1) } 40% { transform: scale(1.18) } 100% { transform: scale(1) } }
      `}</style>

      <header style={{ padding: "44px 18px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isRtl ? "סריקת ציוד" : "Scan equipment"}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span key={count} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 11px", borderRadius: 999, background: "rgba(255,255,255,0.1)",
            fontSize: 12, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
            animation: phase === "success" ? "scanCountPop 360ms ease-out" : "none",
          }}>
            <Icon name="scanLine" size={13} /> {count} {isRtl ? "היום" : "today"}
          </span>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 999, border: 0,
            background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 20,
            display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>×</button>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 18px" }}>
        {phase === "scanning" ? (
          <>
            <button
              onClick={() => setPhase("success")}
              aria-label="Simulate scan"
              style={{
                width: 220, height: 220, position: "relative", padding: 0,
                border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24,
                background: "transparent", cursor: "pointer",
              }}
            >
              {[
                { top: -2, left: -2 }, { top: -2, right: -2 },
                { bottom: -2, left: -2 }, { bottom: -2, right: -2 },
              ].map((p, i) => (
                <span key={i} style={{
                  position: "absolute", width: 24, height: 24,
                  borderStyle: "solid", borderWidth: 3, ...p,
                  borderTopColor: p.top !== undefined ? "var(--action)" : "transparent",
                  borderBottomColor: p.bottom !== undefined ? "var(--action)" : "transparent",
                  borderLeftColor: p.left !== undefined ? "var(--action)" : "transparent",
                  borderRightColor: p.right !== undefined ? "var(--action)" : "transparent",
                }} />
              ))}
              <span style={{
                position: "absolute", top: 14, left: 14, right: 14, height: 2, background: "var(--action)",
                boxShadow: "0 0 16px var(--action)", animation: "scanSweep 1.6s ease-in-out infinite",
              }} />
            </button>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{isRtl ? "סרוק כל קוד QR או תג NFC" : "Point at any QR or NFC tag"}</p>
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center", maxWidth: 240 }}>
              {isRtl ? "הקש על המסגרת כדי לדמות סריקה." : "Tap the frame to simulate a scan."}
            </p>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            {/* Sub-300ms green check */}
            <div style={{ position: "relative", width: 110, height: 110, display: "grid", placeItems: "center" }}>
              <svg viewBox="0 0 100 100" width="110" height="110">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--action)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray="264" strokeDashoffset="264" transform="rotate(-90 50 50)"
                  style={{ animation: "scanRing 360ms cubic-bezier(0.3,0.8,0.3,1) both" }} />
                <path d="M34 51 L45 62 L67 39" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="30" strokeDashoffset="30"
                  style={{ animation: "scanCheck 260ms ease-out 300ms both" }} />
              </svg>
            </div>
            {/* Equipment card updates instantly */}
            <div style={{
              width: "100%", maxWidth: 300, borderRadius: 18, padding: 16,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
              display: "flex", alignItems: "center", gap: 12,
              animation: "scanCardPop 320ms ease-out 200ms both",
            }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.08)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="package" size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0, textAlign: isRtl ? "right" : "left" }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>ECG Monitor uMEC10</p>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                  ICU 1 · <span style={{ color: "var(--action)", fontWeight: 600 }}>{isRtl ? "פעיל" : "Operational"}</span>
                </p>
              </div>
              <Icon name="check" size={18} className="" />
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>{isRtl ? "עודכן · המשך לסרוק" : "Logged · keep scanning"}</p>
          </div>
        )}
      </div>

      {phase === "scanning" && (
        <footer style={{ padding: "0 18px 36px", display: "flex", gap: 10 }}>
          <button style={{
            flex: 1, height: 50, borderRadius: 16, border: 0,
            background: "rgba(255,255,255,0.14)", color: "#fff",
            fontWeight: 600, fontSize: 14, fontFamily: "var(--font-sans)", cursor: "pointer",
          }}>{isRtl ? "הזן ידנית" : "Enter manually"}</button>
          <button onClick={() => setPhase("success")} style={{
            flex: 1, height: 50, borderRadius: 16, border: 0,
            background: "var(--action)", color: "#06140c",
            fontWeight: 700, fontSize: 14, fontFamily: "var(--font-sans)", cursor: "pointer",
          }}>{isRtl ? "דמה סריקה" : "Simulate scan"}</button>
        </footer>
      )}
    </div>
  );
}
window.ScanOverlay = ScanOverlay;
