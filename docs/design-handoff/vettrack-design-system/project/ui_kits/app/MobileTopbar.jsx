// App — Mobile Topbar (sticky, with menu + bell + avatar).
function MobileTopbar({ title, dir = "ltr" }) {
  return (
    <header dir={dir} style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "var(--nav-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderBottom: "1px solid var(--ivory-border)",
      padding: "12px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        <button style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ivory-text-2)", flexShrink: 0 }}>
          <Icon name="menu" size={18} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: "var(--brand)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="qrCode" size={14} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ivory-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", position: "relative", color: "var(--ivory-text-2)" }}>
          <Icon name="bell" size={18} />
          <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, background: "#dc2626", borderRadius: 999, border: "2px solid var(--ivory-surface)" }} />
        </button>
        <button style={{ width: 40, height: 40, borderRadius: 12, background: "var(--brand)", color: "#fff", border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="user" size={18} />
        </button>
      </div>
    </header>
  );
}
window.MobileTopbar = MobileTopbar;
