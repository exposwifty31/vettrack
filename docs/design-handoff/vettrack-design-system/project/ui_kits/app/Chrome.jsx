// App — Top bar (mobile). Forest navy bar, app title + sync state + menu.
function AppTopBar({ title = "Dashboard", online = true }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 40,
      height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px",
      background: "var(--ivory-surface)",
      borderBottom: "1px solid var(--ivory-border)",
    }}>
      <button aria-label="Menu" style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--ivory-text-2)", borderRadius: 10 }}>
        <Icon name="menu" size={20} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, background: "var(--primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="qrCode" size={14} />
        </span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "var(--ivory-text)", letterSpacing: "-0.01em" }}>{title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span title={online ? "Online" : "Offline"} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 999,
          background: online ? "hsl(142 76% 36% / 0.1)" : "hsl(38 92% 50% / 0.15)",
          color: online ? "#15803d" : "#a16207",
          fontSize: 11, fontWeight: 600,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: online ? "#16a34a" : "#d97706" }} />
          {online ? "Live" : "Offline"}
        </span>
      </div>
    </header>
  );
}

// App — Bottom nav (mobile). Fixed; 5 tabs; active = primary pill underneath.
function BottomNav({ active = "home" }) {
  const tabs = [
    { id: "home",      icon: "home",      label: "Home" },
    { id: "patients",  icon: "pawPrint",  label: "Patients" },
    { id: "scan",      icon: "scan",      label: "", primary: true },
    { id: "tasks",     icon: "listTodo",  label: "Tasks" },
    { id: "more",      icon: "menu",      label: "More" },
  ];
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
      height: 68, padding: "8px 12px",
      background: "var(--ivory-surface)",
      borderTop: "1px solid var(--ivory-border)",
      display: "flex", alignItems: "center", justifyContent: "space-around",
      boxShadow: "0 -4px 24px -8px rgba(0,0,0,0.08)",
    }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        if (t.primary) {
          return (
            <button key={t.id} aria-label="Scan" style={{
              width: 56, height: 56, borderRadius: 18, border: 0,
              background: "var(--primary)", color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 10px 24px -8px rgb(15 31 17 / 0.4)",
              transform: "translateY(-12px)",
              cursor: "pointer",
            }}>
              <Icon name={t.icon} size={24} />
            </button>
          );
        }
        return (
          <button key={t.id} style={{
            flex: 1, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "4px 0", background: "transparent", border: 0, cursor: "pointer",
            color: isActive ? "var(--primary)" : "var(--ivory-text-3)",
          }}>
            <Icon name={t.icon} size={20} />
            <span style={{ fontSize: 10.5, fontWeight: 600 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

window.AppTopBar = AppTopBar;
window.BottomNav = BottomNav;
