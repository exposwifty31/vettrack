// App — Equipment list screen (mobile). Search + chip filters + list of equipment items.
function EquipmentScreen({ dir = "ltr" }) {
  const isRtl = dir === "rtl";
  const items = [
    { name: isRtl ? "מוניטור Mindray uMEC10" : "ECG Monitor — Mindray uMEC10", room: "ICU 1", last: "2m", status: "Operational",     animal: "Bella · Lab" },
    { name: isRtl ? "דפיברילטור EQ-0492" : "Defibrillator EQ-0492",            room: "OR 3",  last: "11m", status: "Review Needed",  animal: null },
    { name: isRtl ? "משאבת מזרק SP-118" : "Syringe Pump SP-118",                room: "ICU 2", last: "23m", status: "Operational",   animal: "Loki · DSH" },
    { name: isRtl ? "מנשם — Hamilton C1" : "Ventilator — Hamilton C1",          room: "ICU 1", last: "1h",  status: "Sterilized",    animal: null },
    { name: isRtl ? "תחנת הרדמה Mindray" : "Anesthesia Workstation",            room: "OR 3",  last: "2h",  status: "Maintenance",   animal: null },
    { name: isRtl ? "מודול דם ARKRAY" : "Blood-gas Analyser ARKRAY",             room: "Lab",   last: "3h",  status: "Operational",   animal: null },
  ];
  const chips = isRtl
    ? ["הכל", "פעיל", "דורש בדיקה", "תחזוקה", "מעוקר"]
    : ["All", "Operational", "Review needed", "Maintenance", "Sterilized"];
  const rooms = ["All rooms", "ICU 1", "ICU 2", "OR 3", "Recovery"];

  return (
    <div dir={dir} style={{ padding: "12px 14px 96px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ivory-text)", margin: 0, letterSpacing: "-0.015em" }}>{isRtl ? "ציוד" : "Equipment"}</h1>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ height: 40, padding: "0 12px", borderRadius: 12, border: "1px solid var(--ivory-border)", background: "var(--ivory-surface)", fontSize: 12, fontWeight: 600, color: "var(--ivory-text-2)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="scanLine" size={14} /> {isRtl ? "סרוק" : "Scan"}
          </button>
          <button style={{ height: 40, padding: "0 12px", borderRadius: 12, background: "var(--primary)", color: "#fff", border: 0, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={14} /> {isRtl ? "הוסף" : "Add"}
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", [isRtl ? "right" : "left"]: 14, color: "var(--ivory-text-3)" }}>
          <Icon name="search" size={15} />
        </span>
        <input
          dir={dir}
          placeholder={isRtl ? "חיפוש ציוד…" : "Search equipment, serial, model…"}
          style={{
            width: "100%", height: 44, borderRadius: 12, border: "1px solid var(--ivory-border)",
            background: "var(--ivory-surface)", padding: isRtl ? "0 40px 0 16px" : "0 16px 0 40px",
            fontSize: 14, color: "var(--ivory-text)", outline: "none",
            boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
            fontFamily: "var(--font-sans)",
          }}
        />
      </div>

      {/* Chips */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {chips.map((c, i) => (
          <span key={c} style={{
            display: "inline-flex", alignItems: "center", padding: "0 14px", height: 34, borderRadius: 999,
            border: `1px solid ${i === 0 ? "var(--primary)" : "var(--ivory-border)"}`,
            background: i === 0 ? "var(--primary)" : "var(--ivory-surface)",
            color: i === 0 ? "#fff" : "var(--ivory-text-3)",
            fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
          }}>{c}</span>
        ))}
      </div>

      {/* Room chips */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {rooms.map((r, i) => (
          <span key={r} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "0 12px", height: 30, borderRadius: 999,
            border: `1px solid ${i === 0 ? "var(--primary)" : "var(--ivory-border)"}`,
            background: i === 0 ? "var(--primary)" : "var(--ivory-surface)",
            color: i === 0 ? "#fff" : "var(--ivory-text-3)",
            fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {i === 0 && <Icon name="mapPin" size={11} />}
            {r}
          </span>
        ))}
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        {items.map((eq, i) => (
          <Card key={i} style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: "var(--ivory-bg)", border: "1px solid var(--ivory-border)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: "var(--ivory-text-3)",
            }}><Icon name="package" size={18} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{eq.name}</div>
              {eq.animal && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color: "#6d28d9", marginTop: 2 }}>
                  <Icon name="pawPrint" size={12} /> {isRtl ? `בשימוש · ${eq.animal}` : `In use · ${eq.animal}`}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 11, color: "var(--ivory-text-3)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="mapPin" size={11} /> {eq.room}</span>
                <span>·</span>
                <span style={{ fontFeatureSettings: "'tnum' 1" }}>{eq.last}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <StatusPill status={eq.status} />
              <span style={{ color: "var(--ivory-text-3)", display: "inline-flex" }}>
                <Icon name={isRtl ? "chevronLeft" : "chevronRight"} size={16} />
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

window.EquipmentScreen = EquipmentScreen;
