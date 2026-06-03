// FirstScanCelebration — a brief earned moment after the day's first scan.
// Restraint: appears, lands one line of recognition + the streak, auto-dismisses.
// NOT permanent chrome. This is the "fun" living in the right room — a moment, not a wallpaper.
function FirstScanCelebration({ open, onClose, dir = "ltr" }) {
  const isRtl = dir === "rtl";
  const { useEffect: ue } = React;
  ue(() => {
    if (!open) return;
    const id = setTimeout(onClose, 3400);
    return () => clearTimeout(id);
  }, [open]);
  if (!open) return null;

  // Confetti-free: a calm radial bloom + ring tick. Mature, not childish.
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 120,
        background: "rgba(10,31,21,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        animation: "fscFade 240ms ease-out",
      }}
      dir={dir}
    >
      <style>{`
        @keyframes fscFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fscPop { 0% { opacity: 0; transform: translateY(12px) scale(0.96) } 60% { transform: translateY(0) scale(1.01) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes fscRing { from { stroke-dashoffset: 264 } to { stroke-dashoffset: 0 } }
        @keyframes fscCheck { from { stroke-dashoffset: 30 } to { stroke-dashoffset: 0 } }
        @keyframes fscBloom { 0% { opacity: 0.5; transform: scale(0.6) } 100% { opacity: 0; transform: scale(1.7) } }
      `}</style>
      <div style={{
        position: "relative", width: "100%", maxWidth: 300,
        borderRadius: 24, padding: "28px 24px 24px",
        background: "linear-gradient(165deg, #0a1f15 0%, #143020 70%, #1a3d28 100%)",
        color: "#fff", textAlign: "center",
        boxShadow: "0 30px 60px -20px rgba(10,31,21,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
        animation: "fscPop 520ms cubic-bezier(0.2,0.9,0.2,1) both",
      }}>
        {/* Ring + check */}
        <div style={{ position: "relative", width: 96, height: 96, margin: "0 auto 18px", display: "grid", placeItems: "center" }}>
          <span aria-hidden="true" style={{ position: "absolute", width: 96, height: 96, borderRadius: 999, background: "radial-gradient(circle, rgba(52,211,153,0.4), transparent 70%)", animation: "fscBloom 900ms ease-out 180ms both" }} />
          <svg viewBox="0 0 100 100" width="96" height="96">
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="#34d399" strokeWidth="6" strokeLinecap="round"
              strokeDasharray="264" strokeDashoffset="264" transform="rotate(-90 50 50)"
              style={{ animation: "fscRing 700ms cubic-bezier(0.3,0.8,0.3,1) 120ms both" }} />
            <path d="M34 51 L45 62 L67 39" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="30" strokeDashoffset="30"
              style={{ animation: "fscCheck 320ms ease-out 640ms both" }} />
          </svg>
        </div>

        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#34d399" }}>
          {isRtl ? "סריקה ראשונה היום" : "First scan of the day"}
        </p>
        <h2 style={{ margin: "8px 0 6px", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
          {isRtl ? "המשמרת התחילה." : "Shift's underway."}
        </h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
          {isRtl ? "ECG מוניטור · ICU 1 מסומן כפעיל." : "ECG monitor logged · ICU 1 marked operational."}
        </p>

        <div style={{
          marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8,
          padding: "7px 14px", borderRadius: 999, background: "rgba(255,255,255,0.08)",
          fontSize: 12, fontWeight: 600,
        }}>
          <span style={{ color: "#e0b87a" }}>🏅</span>
          {isRtl ? "רצף של 5 משמרות נמשך" : "5-shift streak continues"}
        </div>

        <p style={{ margin: "16px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          {isRtl ? "הקש להמשך" : "Tap to continue"}
        </p>
      </div>
    </div>
  );
}
window.FirstScanCelebration = FirstScanCelebration;
