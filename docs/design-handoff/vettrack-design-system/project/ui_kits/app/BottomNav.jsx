// App — Bottom nav (fixed inside the device frame).
function BottomNav({ active = "home", dir = "ltr" }) {
  const items = [
    { id: "home", icon: "home", label: "Home" },
    { id: "equip", icon: "boxes", label: "Equipment" },
    { id: "scan", icon: "scanLine", label: "Scan", primary: true },
    { id: "tasks", icon: "listTodo", label: "Tasks", badge: 3 },
    { id: "alerts", icon: "shieldAlert", label: "Alerts" },
  ];
  return (
    <nav dir={dir} style={{
      position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 40,
      background: "hsl(0 0% 100% / 0.96)", backdropFilter: "blur(12px)",
      borderTop: "1px solid var(--ivory-border)",
      padding: "8px 8px 16px", display: "flex", justifyContent: "space-between", alignItems: "end", gap: 4,
    }}>
      {items.map(it => {
        const isActive = it.id === active;
        if (it.primary) {
          return (
            <button key={it.id} style={{
              width: 56, height: 56, borderRadius: 18, background: "var(--primary)", color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center", border: 0,
              boxShadow: "0 10px 24px -8px rgb(15 31 17 / 0.45)", marginTop: -16, flexShrink: 0,
            }}>
              <Icon name={it.icon} size={22} />
            </button>
          );
        }
        return (
          <button key={it.id} style={{
            background: "transparent", border: 0, padding: "6px 4px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: isActive ? "var(--primary)" : "var(--ivory-text-3)",
            position: "relative", flex: 1, minWidth: 0,
          }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name={it.icon} size={20} />
              {it.badge && (
                <span style={{
                  position: "absolute", top: -6, right: -10, minWidth: 16, height: 16, padding: "0 4px",
                  background: "#dc2626", color: "#fff", borderRadius: 999, fontSize: 10, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>{it.badge}</span>
              )}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600 }}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
window.BottomNav = BottomNav;
