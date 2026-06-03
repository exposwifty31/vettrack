// App — Dashboard page composition. Mirrors `src/pages/home.tsx` (mobile).
function Dashboard() {
  const kpis = [
    { id: "patients", title: "Active patients", value: "18", sub: "In active treatment", icon: "users" },
    { id: "tasks",    title: "Tasks due",       value: "12", sub: "Today + overdue",    icon: "listTodo" },
    { id: "alerts",   title: "Inventory alerts", value: "3", sub: "Need review",        icon: "shieldAlert" },
    { id: "charges",  title: "Captured this shift", value: "₪4,820", sub: "23 items billed", icon: "dollar" },
  ];
  const quicks = [
    { id: "scan",  label: "Scan",        hint: "QR or NFC",     icon: "scan",     accent: true },
    { id: "task",  label: "Add task",    hint: "Create or assign", icon: "filePlus" },
    { id: "inv",   label: "Inventory",   hint: "Stock & assets", icon: "boxes" },
    { id: "bill",  label: "Billing",     hint: "Ledger & charges", icon: "receipt" },
  ];
  const activity = [
    { name: "ECG monitor · EQ-0492", action: "Checked out by L. Cohen", when: "2 min", status: "ok" },
    { name: "Defibrillator · EQ-0214", action: "Marked review needed", when: "12 min", status: "issue" },
    { name: "Syringe pump · EQ-0173", action: "Returned to ICU 2", when: "26 min", status: "ok" },
    { name: "Anesthesia ventilator", action: "Sterilization cycle started", when: "41 min", status: "sterilized" },
  ];
  const alerts = [
    { name: "Defibrillator · EQ-0214", detail: "Last check 9 days ago — overdue", tone: "issue" },
    { name: "Syringe pump · EQ-0098", detail: "Scheduled maintenance · today 16:00", tone: "maintenance" },
    { name: "Endoscope set · sterilization", detail: "Cycle in progress · est. 22 min remaining", tone: "sterilized" },
  ];
  return (
    <div style={{ paddingBottom: 96 }}>
      <AppTopBar title="Dashboard" />
      <main style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Greeting card */}
        <section style={{
          borderRadius: 18, padding: "16px 18px",
          background: "linear-gradient(135deg, var(--ivory-surface), hsl(42 18% 91% / 0.55))",
          border: "1px solid hsl(40 12% 81% / 0.6)", boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999, background: "var(--ivory-bg)",
            border: "1px solid var(--ivory-border)", color: "var(--ivory-text-3)",
            fontSize: 11, fontWeight: 500, marginBottom: 8,
          }}>
            <span style={{ color: "var(--primary)" }}><Icon name="sparkles" size={12} /></span>
            Today · Day shift
          </span>
          <h1 style={{ margin: "2px 0", fontSize: 24, lineHeight: 1.2, color: "var(--ivory-text)", letterSpacing: "-0.015em" }}>Hi, Liat</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ivory-text-3)" }}>Equipment overview · ICU & OR · 4 rooms active</p>
        </section>

        {/* KPIs */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {kpis.map(k => <KpiCard key={k.id} {...k} />)}
        </section>

        {/* Quick actions */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {quicks.map(q => <QuickAction key={q.id} {...q} />)}
        </section>

        {/* Live activity */}
        <section style={{
          background: "var(--ivory-surface)", borderRadius: 16, border: "1px solid var(--ivory-border)",
          boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.05)", padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, margin: 0, color: "var(--ivory-text)" }}>
              <span style={{ color: "var(--primary)" }}><Icon name="activity" size={16} /></span>
              Live activity
            </h2>
            <span style={{
              padding: "2px 10px", borderRadius: 999,
              background: "hsl(125 32% 93%)", color: "hsl(129 15% 25%)",
              fontSize: 11, fontWeight: 600,
            }}>4 events</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.map((a, i) => <ActivityRow key={i} {...a} />)}
          </div>
        </section>

        {/* Inventory alerts */}
        <section style={{
          background: "var(--ivory-surface)", borderRadius: 16, border: "1px solid var(--ivory-border)",
          boxShadow: "0 1px 2px 0 rgb(15 23 42 / 0.05)", padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, margin: 0, color: "var(--ivory-text)" }}>
              <span style={{ color: "var(--destructive)" }}><Icon name="alert" size={16} /></span>
              Inventory alerts
            </h2>
            <a href="#" style={{ fontSize: 12, color: "var(--ivory-text-3)", textDecoration: "none" }}>View all →</a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => <AlertRow key={i} {...a} />)}
          </div>
        </section>
      </main>
      <BottomNav active="home" />
    </div>
  );
}

window.Dashboard = Dashboard;
