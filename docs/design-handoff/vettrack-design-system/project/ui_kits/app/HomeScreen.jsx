// App — Home screen content (mobile). Greeting + KPIs + quick actions + live activity.
function HomeScreen({ dir = "ltr", strings }) {
  const s = strings || {
    greeting: "Good morning, Maya",
    sub: "Equipment overview · 4 May",
    shiftSummary: "Shift summary",
    kpi: {
      patients: { title: "Active patients", value: "18", sub: "In active treatment" },
      tasks:    { title: "Tasks due",       value: "12", sub: "Today + overdue" },
      alerts:   { title: "Inventory alerts",value: "3",  sub: "Need review" },
      charges:  { title: "Captured shift",  value: "₪4,820", sub: "23 items billed" },
    },
    quick: { scan: "Scan", scanH: "QR or NFC", task: "Add task", taskH: "Create or assign", inv: "Inventory", invH: "Stock & assets", bill: "Billing", billH: "Charges & ledger" },
    activity: { heading: "Live activity", count: "6 events", view: "View all" },
    alerts: { heading: "Inventory alerts", view: "View all", empty: "All systems healthy" },
  };
  const isRtl = dir === "rtl";
  const start = isRtl ? "right" : "left";
  const end = isRtl ? "left" : "right";
  const chevron = isRtl ? "chevronLeft" : "chevronRight";

  const activity = [
    { name: "ECG Monitor — Mindray uMEC10",  note: "Status updated · Operational", time: "2m", status: "ok",  who: "Maya · ICU 1" },
    { name: "Defibrillator EQ-0492",         note: "Moved to OR 3",                time: "11m", status: "ok", who: "Daniel · scanned" },
    { name: "Syringe Pump SP-118",           note: "Returned · plugged in",        time: "23m", status: "ok", who: "Maya · ICU 2" },
    { name: "Anesthesia Workstation",        note: "Maintenance scheduled",        time: "48m", status: "warn", who: "Auto · weekly check" },
  ];
  const alerts = [
    { name: "Defibrillator EQ-0492", detail: "Last checked 9 days ago",   type: "Review Needed" },
    { name: "Syringe Pump SP-201",   detail: "Maintenance overdue 2 days", type: "Maintenance" },
    { name: "Crash Cart C-2",        detail: "Sterilization expiring in 6h", type: "Due Check" },
  ];

  return (
    <div dir={dir} style={{ padding: "12px 14px 96px", display: "flex", flexDirection: "column", gap: 14, background: "var(--background)" }}>
      {/* Greeting card */}
      <Card style={{ padding: "14px 16px", background: "linear-gradient(135deg, var(--ivory-surface), hsl(42 18% 91% / 0.4))" }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 999, border: "1px solid var(--ivory-border)",
              background: "hsl(0 0% 100% / 0.8)", fontSize: 10.5, fontWeight: 500, color: "var(--ivory-text-3)",
            }}>
              <span style={{ color: "var(--primary)", display: "inline-flex" }}><Icon name="sparkles" size={12} /></span>
              Today
            </span>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--ivory-text)", letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{s.greeting}</h1>
            <p style={{ fontSize: 13, color: "var(--ivory-text-3)", margin: 0 }}>{s.sub}</p>
          </div>
          <button style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 36, padding: "0 12px", borderRadius: 10,
            background: "var(--ivory-surface)", border: "1px solid var(--ivory-border)",
            fontSize: 12, fontWeight: 600, color: "var(--ivory-text-2)", whiteSpace: "nowrap",
          }}>
            <Icon name="check" size={13} /> {s.shiftSummary}
          </button>
        </div>
      </Card>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <KpiCard title={s.kpi.patients.title} value={s.kpi.patients.value} sub={s.kpi.patients.sub} icon="users"       tint="neutral" />
        <KpiCard title={s.kpi.tasks.title}    value={s.kpi.tasks.value}    sub={s.kpi.tasks.sub}    icon="listTodo"    tint="neutral" />
        <KpiCard title={s.kpi.alerts.title}   value={s.kpi.alerts.value}   sub={s.kpi.alerts.sub}   icon="shieldAlert" tint="err" />
        <KpiCard title={s.kpi.charges.title}  value={s.kpi.charges.value}  sub={s.kpi.charges.sub}  icon="dollar"      tint="ok" />
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { id: "scan", label: s.quick.scan,  hint: s.quick.scanH, icon: "scan" },
          { id: "task", label: s.quick.task,  hint: s.quick.taskH, icon: "filePlus" },
          { id: "inv",  label: s.quick.inv,   hint: s.quick.invH,  icon: "boxes" },
          { id: "bill", label: s.quick.bill,  hint: s.quick.billH, icon: "receipt" },
        ].map(a => (
          <Card key={a.id} style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 80 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ivory-text)" }}>{a.label}</div>
              <div style={{ fontSize: 11.5, color: "var(--ivory-text-3)", marginTop: 2 }}>{a.hint}</div>
            </div>
            <span style={{
              width: 36, height: 36, borderRadius: 12,
              background: "var(--ivory-bg)", border: "1px solid var(--ivory-border)",
              color: "var(--ivory-text-2)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}><Icon name={a.icon} size={16} /></span>
          </Card>
        ))}
      </div>

      {/* Live activity */}
      <Card style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--ivory-text)", margin: 0 }}>
            <span style={{ color: "var(--primary)", display: "inline-flex" }}><Icon name="activity" size={15} /></span>
            {s.activity.heading}
          </h2>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 999, background: "var(--secondary)", color: "var(--secondary-foreground)", fontSize: 10.5, fontWeight: 600, fontFeatureSettings: "'tnum' 1" }}>{s.activity.count}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activity.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10,
              padding: 12, borderRadius: 12, border: "1px solid hsl(40 12% 81% / 0.6)", background: "hsl(45 25% 94% / 0.5)",
            }}>
              <div style={{ display: "flex", gap: 10, minWidth: 0, flex: 1 }}>
                <span style={{
                  marginTop: 2, width: 30, height: 30, borderRadius: 10,
                  background: "var(--ivory-bg)", border: "1px solid var(--ivory-border)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: a.status === "ok" ? "var(--primary)" : "#d97706",
                  flexShrink: 0,
                }}><Icon name={a.status === "ok" ? "check" : "wrench"} size={14} /></span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--ivory-text)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
                  <p style={{ fontSize: 11.5, color: "var(--ivory-text-3)", margin: "2px 0 0", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{a.note} · {a.who}</p>
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--ivory-text-3)", fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap" }}>{a.time}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Inventory alerts */}
      <Card style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--ivory-text)", margin: 0 }}>
            <span style={{ color: "#dc2626", display: "inline-flex" }}><Icon name="alert" size={15} /></span>
            {s.alerts.heading}
          </h2>
          <button style={{ background: "transparent", border: 0, color: "var(--ivory-text-3)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{s.alerts.view}</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              padding: "10px 12px", borderRadius: 12, border: "1px solid hsl(40 12% 81% / 0.6)", background: "hsl(45 25% 94% / 0.5)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ivory-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ivory-text-3)", marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{a.detail}</div>
              </div>
              <StatusPill status={a.type} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

window.HomeScreen = HomeScreen;
