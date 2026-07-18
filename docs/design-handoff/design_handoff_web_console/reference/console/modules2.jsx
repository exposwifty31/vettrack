/* VetTrack Console — modules part 2 (Integrations, Notifications, RFID, Ops, Analytics, Audit). Adds to window.MODULES. */
(function () {
  const U = window.UI, D = window.VTDATA, e = U.e;
  const { t, tn, N, Icon, Pill, DotChip, Avatar, Card, Table, TD, Row, Drawer, DrawerHead, Field, FieldVal, Btn, LeadNote, Tabs } = U;
  const { useState } = React;
  const grid = (cols, extra) => Object.assign({ display: 'grid', gridTemplateColumns: cols, gap: 16 }, extra);
  const wrap = (children) => e('div', { style: { maxWidth: 1180, marginInline: 'auto', display: 'flex', flexDirection: 'column', gap: 16 } }, children);
  const muted = (s) => ({ font: s || '500 12px var(--font-sans)', color: 'var(--muted-foreground)' });
  function PrimaryRow({ tabsEl, action }) { return e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, tabsEl, action && e('div', { style: { marginInlineStart: 'auto' } }, action)); }
  function MaskedTag({ loc }) { return e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 6, background: 'var(--tonal)', color: 'var(--muted-foreground)', font: '600 9px var(--font-sans)', letterSpacing: '.04em', textTransform: 'uppercase' } }, e(Icon, { name: 'lock', size: 9, sw: 2.4 }), tn(D.t.masked, loc)); }

  // ============ INTEGRATIONS ============
  function Integrations({ loc, isLead }) {
    const G = D.integrations, he = loc === 'he';
    const [tab, setTab] = useState('integrations');
    const [dw, setDw] = useState(null);
    const prim = !isLead && e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(tab === 'webhooks' ? G.addWebhook : G.addIntegration, loc));

    const cards = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, G.list.map((g, i) => e('div', { key: i, 'data-screen-label': 'Integration', style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } }, e('div', { style: { width: 40, height: 40, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: 'plug', size: 20, sw: 1.9 })), e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { dir: 'ltr', style: { font: '700 15px var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, g.vendor), e('p', { style: { font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)', margin: '1px 0 0' } }, tn(g.kind, loc))), e(Pill, { st: g.st, style: { padding: '4px 10px', font: '600 11.5px var(--font-sans)' } }, tn(g.s, loc))),
      e('div', { style: grid('1fr 1fr 1fr', { gap: 14 }) },
        e(Field, { label: tn(G.fEndpoint, loc) }, e('p', { dir: 'ltr', style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.endpoint)),
        e(Field, { label: tn(G.fApiKey, loc) }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } }, e('span', { dir: 'ltr', style: { font: '500 13px var(--font-num)', color: 'var(--foreground)', letterSpacing: '.06em' } }, '•••• ' + g.key), e(MaskedTag, { loc }))),
        e(Field, { label: tn(G.fLastSync, loc) }, e('p', { dir: 'auto', style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)', margin: 0 } }, tn(g.lastSync, loc)))),
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--hairline)', paddingTop: 13 } }, e('span', { style: muted() }, tn(g.summary, loc)), e('div', { style: { marginInlineStart: 'auto', display: 'flex', gap: 8 } },
        e('button', { type: 'button', className: 'vt-btn vt-btn-link', onClick: () => setDw(i), style: sm() }, tn(isLead ? G.viewConfig : G.editCred, loc)), !isLead && e('button', { type: 'button', className: 'vt-btn vt-btn-ghost', onClick: () => {}, style: Object.assign(sm(), { color: 'var(--foreground)' }) }, tn(G.syncNow, loc)))))));

    const webhooks = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      e('div', null, e('div', { style: { font: '700 13px var(--font-sans)', color: 'var(--foreground)', margin: '0 0 8px' } }, tn(G.epTitle, loc)), e(Table, { cols: G.epCols.map((c) => tn(c, loc)).concat('') }, G.endpoints.map((w, i) => e('tr', { key: i, className: 'vt-row' },
        e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, w.url)), e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--muted-foreground)', letterSpacing: '.06em' } }, e('span', { dir: 'ltr' }, 'whsec_•••• ' + w.secret)), e(TD, { style: muted() }, e('span', { dir: 'ltr' }, w.events)), e(TD, null, e(Pill, { st: w.st }, tn(w.s, loc))), e(TD, null, !isLead && e('button', { type: 'button', className: 'vt-btn vt-btn-link', style: { height: 30, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--brand)', font: '700 11.5px var(--font-sans)', cursor: 'pointer' } }, tn(G.rotate, loc))))))),
      e('div', null, e('div', { style: { font: '700 13px var(--font-sans)', color: 'var(--foreground)', margin: '0 0 8px' } }, tn(G.logTitle, loc)), e(Table, { cols: G.logCols.map((c) => tn(c, loc)) }, G.deliveries.map((d, i) => e('tr', { key: i, className: 'vt-row' },
        e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, d.event)), e(TD, null, e(Pill, { st: d.st }, tn(d.s, loc))), e(TD, { style: { font: '600 12px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, d.code)), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(d.when, loc))))))));

    const g = dw != null ? G.list[dw] : null; const dd = G.drawer;
    const drawer = e(Drawer, { open: g != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: g && (isLead ? e(Btn, { kind: 'ghost', flex: true, onClick: () => setDw(null) }, tn(D.t.close, loc)) : e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true }, tn(dd.rotateBtn, loc)), e(Btn, { kind: 'ghost', onClick: () => setDw(null) }, tn(dd.cancel, loc)))) },
      g && e(DrawerHead, { onClose: () => setDw(null) }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } }, e('div', { style: { width: 40, height: 40, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: 'plug', size: 20, sw: 1.9 })), e('div', { style: { flex: 1, minWidth: 0 } }, e('h3', { dir: 'ltr', style: { font: '700 17px var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, g.vendor), e('p', { style: { font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)', margin: '2px 0 0' } }, tn(g.kind, loc))))),
      g && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e(Field, { label: tn(G.fEndpoint, loc) }, e('p', { dir: 'ltr', style: { font: '500 13px var(--font-num)', color: 'var(--foreground)', margin: 0, wordBreak: 'break-all' } }, g.endpoint)),
        e(Field, { label: tn(G.fApiKey, loc) }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { dir: 'ltr', style: { font: '500 14px var(--font-num)', color: 'var(--foreground)', letterSpacing: '.08em' } }, '•••• •••• ' + g.key), e(MaskedTag, { loc })), e('p', { style: { font: '400 12px/1.5 var(--font-sans)', color: 'var(--muted-foreground)', margin: '8px 0 0' } }, tn(dd.explainer, loc))),
        !isLead && e(Field, { label: tn(dd.newKey, loc) }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderRadius: 10, background: 'var(--background)', border: '1px dashed var(--border-strong)' } }, e(Icon, { name: 'plus', size: 14, sw: 2, color: 'var(--muted-foreground)' }), e('span', { style: muted('500 13px var(--font-sans)') }, tn(dd.placeholder, loc))), e('p', { style: { font: '400 12px/1.5 var(--font-sans)', color: 'var(--muted-foreground)', margin: '8px 0 0' } }, tn(dd.writeOnly, loc))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null, e(PrimaryRow, { tabsEl: e(Tabs, { items: G.tabs, value: tab, onChange: (v) => { setTab(v); setDw(null); }, loc }), action: prim }), tab === 'integrations' ? cards : webhooks)), drawer);
  }
  function sm() { return { height: 34, padding: '0 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--brand)', font: '700 12.5px var(--font-sans)', cursor: 'pointer' }; }

  // ============ NOTIFICATIONS ============
  function Notifications({ loc, isLead }) {
    const G = D.notifications, he = loc === 'he';
    const [tab, setTab] = useState('channels');
    const [dw, setDw] = useState(null);
    const prim = !isLead && tab === 'templates' && e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(G.newTemplate, loc));

    const channels = e('div', { style: grid('1fr 1fr') }, G.channels.map((c, i) => e('div', { key: i, 'data-screen-label': 'Channel', style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 13 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 11 } }, e('div', { style: { width: 38, height: 38, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: c.icon, size: 19, sw: 1.9 })), e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { style: { font: '700 14.5px var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(c.name, loc)), e('p', { dir: 'ltr', style: { font: '500 11.5px var(--font-sans)', color: 'var(--muted-foreground)', margin: '1px 0 0' } }, c.provider)), e(Pill, { st: c.st, style: { padding: '4px 10px' } }, tn(c.s, loc))),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' } }, e('span', { style: muted() }, tn(G.credential, loc)), e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, e('span', { dir: 'ltr', style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)', letterSpacing: '.06em' } }, '•••• ' + c.cred), e(MaskedTag, { loc }))),
        e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted() }, tn(G.last24, loc)), e('span', { dir: 'auto', style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, tn(c.summary, loc)))),
      e('div', { style: { marginTop: 'auto', display: 'flex', gap: 8, borderTop: '1px solid var(--hairline)', paddingTop: 12 } }, !isLead ? e(React.Fragment, null, e('button', { type: 'button', className: 'vt-btn vt-btn-link', style: sm() }, tn(G.configure, loc)), e('button', { type: 'button', className: 'vt-btn vt-btn-ghost', style: Object.assign(sm(), { color: 'var(--foreground)' }) }, tn(G.sendTest, loc))) : e('span', { style: Object.assign(muted(), { alignSelf: 'center' }) }, tn(D.t.readonly, loc))))));

    const templates = e(Table, { cols: G.tmCols.map((c) => tn(c, loc)).concat('') }, G.templates.map((m, i) => { const st = G.tmStatus[m.status]; return e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
      e(TD, { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(m.name, loc)), e(TD, null, e(DotChip, { color: m.channel === 'whatsapp' ? 'rgb(52 199 89)' : 'rgb(0 122 255)' }, tn(G.chLabel[m.channel], loc))), e(TD, { style: muted('500 12.5px var(--font-sans)') }, tn(m.audience, loc)), e(TD, null, e(Pill, { st: st.st }, tn(st.s, loc)))); }));

    const log = e(Table, { cols: G.logCols.map((c) => tn(c, loc)) }, G.deliveries.map((d, i) => e('tr', { key: i, className: 'vt-row' },
      e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, d.recipient)), e(TD, null, e(DotChip, { color: d.channel === 'whatsapp' ? 'rgb(52 199 89)' : 'rgb(0 122 255)' }, tn(G.chLabel[d.channel], loc))), e(TD, null, e(Pill, { st: d.st }, tn(d.s, loc))), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(d.when, loc))))));

    const m = dw != null ? G.templates[dw] : null; const dd = G.drawer; const st = m && G.tmStatus[m.status];
    const drawer = e(Drawer, { open: m != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: m && (isLead ? e(Btn, { kind: 'ghost', flex: true, onClick: () => setDw(null) }, tn(D.t.close, loc)) : e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true }, tn(dd.edit, loc)), e(Btn, { kind: 'ghost' }, tn(G.sendTest, loc)))) },
      m && e(DrawerHead, { onClose: () => setDw(null) }, e('p', { style: { font: '600 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: '0 0 5px' } }, tn(dd.kind, loc)), e('h3', { style: { font: '700 17px/1.35 var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, tn(m.name, loc))),
      m && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: grid('1fr 1fr', { gap: '16px 14px' }) },
          e(Field, { label: tn(dd.channel, loc) }, e(FieldVal, { style: { font: '600 13.5px var(--font-sans)' } }, tn(G.chLabel[m.channel], loc))), e(Field, { label: tn(dd.trigger, loc) }, e(FieldVal, { dir: 'ltr', style: { font: '600 13px var(--font-num)' } }, m.trigger)),
          e(Field, { label: tn(dd.audience, loc) }, e(FieldVal, { style: { font: '600 13.5px var(--font-sans)' } }, tn(m.audience, loc))), e(Field, { label: tn(dd.status, loc) }, e(Pill, { st: st.st, style: { padding: '4px 10px', font: '600 12px var(--font-sans)' } }, tn(st.s, loc)))),
        e(Field, { label: tn(dd.preview, loc) }, e('div', { style: { background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' } }, e('p', { style: { font: '400 13.5px/1.6 var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(m.body, loc))), e('p', { style: { font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--muted-foreground)', margin: '8px 0 0' } }, tn(dd.phNote, loc))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null, e(PrimaryRow, { tabsEl: e(Tabs, { items: G.tabs, value: tab, onChange: (v) => { setTab(v); setDw(null); }, loc }), action: prim }), tab === 'channels' ? channels : tab === 'templates' ? templates : log)), drawer);
  }

  // ============ RFID ============
  function Rfid({ loc, isLead }) {
    const G = D.rfid, he = loc === 'he';
    const [dw, setDw] = useState(null);
    const counts = { online: 0, degraded: 0, offline: 0 }; G.readers.forEach((r) => counts[r.status]++);
    const chip = (n, label, st) => e(Pill, { st, dot: true, style: { padding: '6px 12px', font: '700 12.5px var(--font-sans)' } }, e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, String(n)), ' ', tn(label, loc));
    const head = e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, chip(counts.online, G.online, 'ok'), chip(counts.degraded, G.degraded, 'maint'), chip(counts.offline, G.offline, 'issue')), !isLead && e('div', { style: { marginInlineStart: 'auto' } }, e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(G.register, loc))));

    const table = e(Table, { cols: G.cols.map((c) => tn(c, loc)).concat('') }, G.readers.map((r, i) => { const st = G.rdStatus[r.status]; return e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
      e(TD, { style: { font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, r.name)), e(TD, { style: { font: '500 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(r.loc, loc)), e(TD, null, e(Pill, { st: st.st }, tn(st.s, loc))), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(r.hb, loc))), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'ltr' }, r.fw))); }));

    const r = dw != null ? G.readers[dw] : null; const dd = G.drawer; const st = r && G.rdStatus[r.status];
    const drawer = e(Drawer, { open: r != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: r && (isLead ? e(Btn, { kind: 'ghost', flex: true, onClick: () => setDw(null) }, tn(D.t.close, loc)) : e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true }, tn(dd.restart, loc)), e(Btn, { kind: 'ghost' }, tn(dd.rename, loc)), e(Btn, { kind: 'danger' }, tn(dd.unpair, loc)))) },
      r && e(DrawerHead, { onClose: () => setDw(null) }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } }, e('div', { style: { width: 40, height: 40, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: 'radio', size: 20, sw: 1.9 })), e('div', { style: { flex: 1, minWidth: 0 } }, e('h3', { dir: 'ltr', style: { font: '700 17px var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, r.name), e('p', { style: { font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)', margin: '2px 0 0' } }, tn(r.loc, loc))))),
      r && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e(Field, { label: tn(dd.status, loc) }, e(Pill, { st: st.st, style: { padding: '4px 10px', font: '600 12px var(--font-sans)' } }, tn(st.s, loc))),
        e('div', { style: grid('1fr 1fr', { gap: '16px 14px' }) },
          e(Field, { label: tn(dd.hb, loc) }, e(FieldVal, { dir: 'auto', style: { fontFamily: 'var(--font-num)' } }, tn(r.hb, loc))), e(Field, { label: tn(dd.fw, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, r.fw)),
          e(Field, { label: tn(dd.dock, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, r.dock)), e(Field, { label: tn(dd.captures, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, r.captures)),
          e(Field, { label: tn(dd.uptime, loc), span: true }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, r.uptime))),
        r.status === 'offline' && e('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--status-issue-bg)', border: '1px solid var(--status-issue-border)', borderRadius: 12, padding: '12px 14px' } }, e(Icon, { name: 'alert', size: 15, sw: 2, color: 'var(--status-issue-fg)', style: { marginTop: 1 } }), e('span', { style: { font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--status-issue-fg)' } }, tn(dd.offlineNote, loc))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null, head, table)), drawer);
  }

  // ============ OPS HEALTH ============
  function Ops({ loc }) {
    const G = D.ops, he = loc === 'he';
    const num = (v, sz, col) => e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontSize: sz || '1.7rem', fontWeight: 700, color: col || 'var(--foreground)', lineHeight: 1 } }, v);
    const metrics = e('section', { 'data-screen-label': 'Operational metrics', style: { gridColumn: 'span 2', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 22px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { color: 'var(--brand)', display: 'flex' } }, e(Icon, { name: 'gauge', size: 17, sw: 2 })), e('h3', { style: { font: '700 15px var(--font-sans)', margin: 0, flex: 1, color: 'var(--foreground)' } }, tn(G.metricsTitle, loc)), e('span', { style: muted('500 11px var(--font-sans)') }, tn(G.metricsWindow, loc))),
      e('div', { style: { display: 'flex', gap: 22, flexWrap: 'wrap' } }, G.kpis.map((k, i) => e('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: 2 } }, num(k.v, '1.6rem', k.ok ? 'var(--status-ok-fg)' : 'var(--foreground)'), e('span', { style: muted('500 11.5px var(--font-sans)') }, tn(k.l, loc))))),
      e('div', { 'aria-hidden': true, style: { display: 'flex', alignItems: 'flex-end', gap: 5, height: 64 } }, G.bars.map((v, i) => e('div', { key: i, style: { flex: 1, borderRadius: '4px 4px 2px 2px', background: i === 9 ? 'var(--brand)' : 'var(--brand-border)', height: v + '%' } }))),
      e('span', { style: muted('400 10.5px var(--font-sans)') }, tn(G.chartNote, loc)));

    const dlq = e('section', { 'data-screen-label': 'Outbox DLQ', style: { gridRow: 'span 2', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 4px 10px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px 12px' } }, e('span', { style: { color: 'var(--status-issue-fg)', display: 'flex' } }, e(Icon, { name: 'inbox', size: 16, sw: 2 })), e('h3', { style: { font: '700 15px var(--font-sans)', margin: 0, flex: 1, color: 'var(--foreground)' } }, tn(G.dlqTitle, loc)), e('span', { dir: 'ltr', style: { minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--status-issue-bg)', color: 'var(--status-issue-fg)', font: '700 11px var(--font-num)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, G.dlqCount)),
      e('div', { style: { flex: 1, overflowY: 'auto' } }, G.dlq.map((d, i) => e('div', { key: i, style: { padding: '11px 18px', borderTop: '1px solid var(--hairline)' } }, e('p', { dir: 'ltr', style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)', margin: 0 } }, d.event), e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 3 } }, e('span', { style: muted('500 11px var(--font-sans)') }, tn(d.attempts, loc)), e('span', { dir: 'auto', style: muted('500 11px var(--font-num)') }, tn(d.age, loc)))))),
      e('div', { style: { padding: '11px 18px 2px', borderTop: '1px solid var(--hairline)' } }, e('p', { style: { font: '400 11px/1.5 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 } }, tn(G.dlqNote, loc))));

    const queue = e(Card, { title: tn(G.queueTitle, loc), icon: 'layers', label: 'Sync queue', right: e(Pill, { st: 'ok', style: { padding: '3px 9px', font: '600 10.5px var(--font-sans)' } }, tn(G.queueHealthy, loc)), style: { borderRadius: 20 } },
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, num(G.queueDepth), e('span', { style: muted('500 12.5px var(--font-sans)') }, tn(G.queueDepthL, loc))),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' } }, e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted() }, tn(G.queueOldestL, loc)), e('span', { dir: 'auto', style: { font: '600 12px var(--font-num)', color: 'var(--foreground)' } }, tn(G.queueOldest, loc))), e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted() }, tn(G.queueTputL, loc)), e('span', { dir: 'ltr', style: { font: '600 12px var(--font-num)', color: 'var(--foreground)' } }, tn(G.queueTput, loc)))));

    const health = e(Card, { title: tn(G.healthTitle, loc), icon: 'activity', label: 'Outbox health', style: { borderRadius: 20 } },
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, num(G.healthPct), e('span', { style: muted('500 12.5px var(--font-sans)') }, tn(G.healthPctL, loc))),
      e('div', { style: { height: 8, borderRadius: 999, background: 'var(--tonal)', overflow: 'hidden', marginTop: 2 } }, e('div', { style: { width: '99.4%', height: '100%', background: 'rgb(52 199 89)', borderRadius: 999 } })),
      e('div', { style: { marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted() }, tn(G.healthDelL, loc)), e('span', { dir: 'ltr', style: { font: '600 12px var(--font-num)', color: 'var(--foreground)' } }, tn(G.healthDel, loc))));

    const displays = e(Card, { title: tn(G.displayTitle, loc), icon: 'monitor', label: 'Display heartbeats', right: e(Pill, { st: 'ok', style: { padding: '3px 9px', font: '600 10.5px var(--font-sans)' } }, tn(G.displaySummary, loc)), style: { gridColumn: 'span 2', borderRadius: 20 } },
      e('div', { style: grid('1fr 1fr', { gap: '8px 20px' }) }, G.displays.map((d, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: '1px solid var(--hairline)' } }, e('span', { style: { width: 8, height: 8, borderRadius: 999, background: 'rgb(52 199 89)', flexShrink: 0 } }), e('span', { style: { flex: 1, font: '600 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(d.name, loc)), e('span', { dir: 'auto', style: muted('500 11px var(--font-num)') }, tn(d.beat, loc))))),
      e('span', { style: muted('400 10.5px/1.5 var(--font-sans)') }, tn(G.displayNote, loc)));

    const roBanner = e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--tonal)', border: '1px solid var(--border)', marginBottom: 16 } },
      e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted-foreground)', font: '700 10px var(--font-sans)', letterSpacing: '.05em', textTransform: 'uppercase', flexShrink: 0 } }, e(Icon, { name: 'lock', size: 11, sw: 2.2, color: 'var(--muted-foreground)' }), he ? 'קריאה בלבד' : 'Read-only'),
      e('span', { style: { font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)' } }, he ? 'לוחות מחוונים מעל טלמטריה קפואה — הקונסולה צופה בלבד; אינה מריצה מחדש, מרוקנת או משנה תעבורה.' : 'Dashboards over frozen telemetry — the console observes only; it never requeues, purges, or changes transport.'));
    return e('div', null, roBanner, e('div', { 'data-bento': true, style: grid('1fr 1fr 1fr', { gridAutoRows: 'minmax(150px,auto)' }) }, metrics, dlq, queue, health, displays));
  }

  // ============ ANALYTICS ============
  function Analytics({ loc, isLead }) {
    const G = D.analytics, he = loc === 'he';
    const [range, setRange] = useState('7d');
    const maxScan = Math.max.apply(null, G.leaders.map((l) => l.scans));
    const top = e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
      e(Tabs, { items: G.ranges.map((r) => [r, r]), value: range, onChange: setRange, loc }),
      e('div', { style: { marginInlineStart: 'auto', display: 'flex', gap: 8 } }, e(Btn, { kind: 'ghost', icon: 'dl', style: { height: 38, borderRadius: 11, font: '700 12.5px var(--font-sans)' } }, tn(G.exportLabel, loc)), !isLead && e(Btn, { kind: 'primary', icon: 'calendar', style: { height: 38, borderRadius: 11, font: '700 12.5px var(--font-sans)' } }, tn(G.schedule, loc))));

    const kpis = e('div', { style: grid('1fr 1fr 1fr 1fr', { gap: 14 }) }, G.kpis.map((k, i) => e('div', { key: i, style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '15px 17px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 4 } }, e('span', { style: muted('500 11.5px var(--font-sans)') }, tn(k.l, loc)), e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 7 } }, e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1 } }, k.v), e('span', { dir: 'ltr', style: { font: '600 11px var(--font-sans)', color: k.up ? 'var(--status-ok-fg)' : 'var(--status-issue-fg)' } }, k.delta)))));

    const trend = e('section', { 'data-screen-label': 'Readiness trend', style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 22px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { color: 'var(--brand)', display: 'flex' } }, e(Icon, { name: 'chart', size: 17, sw: 2 })), e('h3', { style: { font: '700 15px var(--font-sans)', margin: 0, flex: 1, color: 'var(--foreground)' } }, tn(G.trendTitle, loc)), e('span', { style: muted('500 11px var(--font-sans)') }, tn(G.trendSub, loc))),
      e('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 10, height: 150 } }, G.trend.map((d, i) => e('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' } }, e('span', { dir: 'ltr', style: { font: '600 10.5px var(--font-num)', color: 'var(--muted-foreground)' } }, d[1] + '%'), e('div', { style: { width: '100%', borderRadius: '6px 6px 3px 3px', background: 'var(--brand)', height: d[1] + '%' } }), e('span', { style: muted('500 10.5px var(--font-sans)') }, tn(d[0], loc))))),
      e('span', { style: muted('400 10.5px var(--font-sans)') }, tn(G.chartNote, loc)));

    const outcome = e(Card, { title: tn(G.outcomeTitle, loc), icon: 'pie', label: 'Outcome mix', style: { borderRadius: 20 } },
      e('div', { style: { display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--tonal)' } }, G.outcome.map((o, i) => e('div', { key: i, style: { width: o.pct, height: '100%', background: o.color } }))),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 } }, G.outcome.map((o, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { width: 9, height: 9, borderRadius: 3, background: o.color, flexShrink: 0 } }), e('span', { style: { flex: 1, font: '500 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(o.label, loc)), e('span', { dir: 'ltr', style: { font: '600 12.5px var(--font-num)', color: 'var(--muted-foreground)' } }, o.pct)))));

    const rooms = e(Card, { title: tn(G.roomTitle, loc), icon: 'home', label: 'Utilization', style: { borderRadius: 20 } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, G.rooms.map((u, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10 } }, e('span', { style: { width: 78, flexShrink: 0, font: '500 12px var(--font-sans)', color: 'var(--foreground)' } }, tn(u.name, loc)), e('div', { style: { flex: 1, height: 8, borderRadius: 999, background: 'var(--tonal)', overflow: 'hidden' } }, e('div', { style: { width: u.pct, height: '100%', background: 'var(--brand)', borderRadius: 999 } })), e('span', { dir: 'ltr', style: { width: 38, textAlign: 'end', font: '600 12px var(--font-num)', color: 'var(--muted-foreground)' } }, u.pct)))));

    const leaders = e(Card, { title: tn(G.leaderTitle, loc), icon: 'trophy', label: 'Shift leaderboard', right: e('span', { style: muted('500 11px var(--font-sans)') }, tn(G.leaderSub, loc)), style: { borderRadius: 20 } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, G.leaders.map((p, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10 } }, e('div', { dir: 'ltr', style: { width: 24, height: 24, borderRadius: 999, background: 'var(--tonal)', color: 'var(--foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 10.5px var(--font-num)', flexShrink: 0 } }, String(i + 1)), e('span', { style: { flex: 1, font: '600 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(p.name, loc)), e('div', { style: { width: 90, height: 8, borderRadius: 999, background: 'var(--tonal)', overflow: 'hidden' } }, e('div', { style: { width: Math.round(p.scans / maxScan * 100) + '%', height: '100%', background: 'var(--action)', borderRadius: 999 } })), e('span', { dir: 'ltr', style: { width: 34, textAlign: 'end', font: '600 12px var(--font-num)', color: 'var(--muted-foreground)' } }, String(p.scans))))));

    const reports = e('section', { 'data-screen-label': 'Saved reports', style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', overflow: 'hidden' } },
      e('div', { style: { padding: '15px 20px 11px', font: '700 14px var(--font-sans)', color: 'var(--foreground)' } }, tn(G.reportsTitle, loc)),
      e(Table, { cols: G.reportCols.map((c) => tn(c, loc)).concat('') }, G.reports.map((r, i) => e('tr', { key: i, className: 'vt-row' },
        e(TD, { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(r.name, loc)), e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'ltr' }, r.range)), e(TD, null, e('span', { dir: 'ltr', style: { display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: 'var(--tonal)', color: 'var(--foreground)', font: '600 10.5px var(--font-num)' } }, r.format)), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(r.lastRun, loc))), e(TD, null, e('button', { type: 'button', className: 'vt-btn vt-btn-ghost', style: { height: 30, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--brand)', font: '700 11.5px var(--font-sans)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 } }, e(Icon, { name: 'dl', size: 12, sw: 2.2 }), tn(G.download, loc)))))));

    return wrap(e(React.Fragment, null, top, kpis, e('div', { style: grid('2fr 1fr') }, trend, outcome), e('div', { style: grid('1fr 1fr') }, rooms, leaders), reports));
  }

  // ============ AUDIT ============
  function Audit({ loc, isLead }) {
    const G = D.audit, he = loc === 'he';
    const [filter, setFilter] = useState('all');
    const [dw, setDw] = useState(null);
    const shown = G.entries.map((x, i) => ({ x, i })).filter((o) => filter === 'all' || o.x.kind === filter);
    const chipStyle = (active) => ({ height: 32, padding: '0 13px', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--border)'), borderRadius: 9, background: active ? 'var(--brand-soft)' : 'var(--surface)', color: active ? 'var(--brand)' : 'var(--muted-foreground)', font: (active ? 700 : 500) + ' 12px var(--font-sans)', cursor: 'pointer', whiteSpace: 'nowrap' });
    const bar = e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      e('span', { style: { font: '600 11px var(--font-sans)', color: 'var(--muted-foreground)', marginInlineEnd: 2 } }, tn(G.filterLabel, loc)),
      G.filters.map((f) => e('button', { key: f[0], type: 'button', className: 'vt-chip', onClick: () => { setFilter(f[0]); setDw(null); }, style: chipStyle(filter === f[0]) }, tn(f[1], loc))),
      e('span', { style: { marginInlineStart: 'auto', font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'ltr' }, shown.length + ' / ' + G.entries.length)));

    const table = e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', overflow: 'hidden' } },
      e(Table, { cols: G.cols.map((c) => tn(c, loc)).concat('') }, shown.map(({ x, i }) => e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
        e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'ltr' }, x.when)),
        e(TD, null, e('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } }, x.system ? e('div', { style: { width: 26, height: 26, borderRadius: 999, background: 'var(--tonal)', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: 'layers', size: 13, sw: 2 })) : e(Avatar, { brand: true, size: 26 }, x.ini), e('span', { style: { font: '600 12.5px var(--font-sans)', color: 'var(--foreground)', whiteSpace: 'nowrap' } }, tn(x.actor, loc)))),
        e(TD, null, e(Pill, { st: G.kindMeta[x.kind].st, dot: false, mono: true }, e('span', { dir: 'ltr' }, x.action))),
        e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, x.target))))),
      e('div', { style: { padding: '11px 18px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' } }, e('span', { style: { font: '500 11.5px var(--font-sans)', color: 'var(--muted-foreground)' } }, tn(G.footNote, loc))));

    const x = dw != null ? G.entries[dw] : null; const dd = G.drawer;
    const drawer = e(Drawer, { open: x != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: x && e(React.Fragment, null, e(Btn, { kind: 'ghost', flex: true, icon: 'dl' }, tn(dd.exportEntry, loc)), e(Btn, { kind: 'ghost', onClick: () => setDw(null) }, tn(D.t.close, loc))) },
      x && e(DrawerHead, { onClose: () => setDw(null) }, e(Pill, { st: G.kindMeta[x.kind].st, dot: false, mono: true, style: { marginBottom: 9 } }, e('span', { dir: 'ltr' }, x.action)), e('h3', { style: { font: '700 16px/1.4 var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, tn(G.kindLabel[x.kind], loc) + ' · ' + x.target)),
      x && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: grid('1fr 1fr', { gap: '16px 14px' }) },
          e(Field, { label: tn(dd.actor, loc) }, e(FieldVal, null, tn(x.actor, loc))), e(Field, { label: tn(dd.role, loc) }, e(FieldVal, null, tn(x.role, loc))),
          e(Field, { label: tn(dd.when, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, 'Today ' + x.when)), e(Field, { label: tn(dd.ip, loc) }, e(FieldVal, { dir: 'ltr', style: { font: '500 12.5px var(--font-num)' } }, x.ip)),
          e(Field, { label: tn(dd.target, loc), span: true }, e(FieldVal, { dir: 'ltr', style: { font: '500 13px var(--font-num)' } }, x.target)),
          e(Field, { label: tn(dd.kind, loc), span: true }, e(FieldVal, { dir: 'ltr', style: { font: '500 12.5px var(--font-num)' } }, x.action))),
        x.diff.length > 0 && e(Field, { label: tn(dd.diff, loc) }, e('div', { dir: 'ltr', style: { background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', fontFamily: 'var(--font-num)', fontSize: 12, lineHeight: 1.7 } }, x.diff.map((d, i) => e('div', { key: i, style: { display: 'flex', gap: 8 } }, e('span', { style: { color: 'var(--muted-foreground)', minWidth: 70 } }, d.k), e('span', { style: { color: 'var(--status-issue-fg)', textDecoration: 'line-through' } }, d.from), e('span', { style: { color: 'var(--muted-foreground)' } }, '→'), e('span', { style: { color: 'var(--status-ok-fg)' } }, d.to))))),
        e('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--surface-2)', border: '1px solid var(--hairline)', borderRadius: 12, padding: '12px 14px' } }, e(Icon, { name: 'shield', size: 15, sw: 2, color: 'var(--muted-foreground)', style: { marginTop: 1 } }), e('span', { style: { font: '500 12px/1.5 var(--font-sans)', color: 'var(--muted-foreground)' } }, tn(dd.note, loc)))));

    return e('div', null, wrap(e(React.Fragment, null, bar, table)), drawer);
  }

  Object.assign(window.MODULES, { Integrations, Notifications, Rfid, Ops, Analytics, Audit });
})();
