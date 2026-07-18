/* VetTrack Console — 10 module views. Exposes window.MODULES. Requires React, window.UI, window.VTDATA. */
(function () {
  const U = window.UI, D = window.VTDATA, e = U.e;
  const { t, tn, N, Icon, Pill, DotChip, Avatar, Card, Table, TD, Row, Drawer, DrawerHead, Field, FieldVal, Btn, LeadNote, Tabs } = U;
  const { useState } = React;

  const grid = (cols, extra) => Object.assign({ display: 'grid', gridTemplateColumns: cols, gap: 16 }, extra);
  const wrap = (children, style) => e('div', { style: Object.assign({ maxWidth: 1180, marginInline: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }, style) }, children);
  const muted = (s) => ({ font: s || '500 12px var(--font-sans)', color: 'var(--muted-foreground)' });
  const numSpan = (v, sz) => e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: sz || 12.5 } }, v);

  function PrimaryRow({ tabsEl, action }) {
    return e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, tabsEl, action && e('div', { style: { marginInlineStart: 'auto' } }, action));
  }

  // ============ HOME ============
  function Home({ loc, isLead, navigate }) {
    const [dw, setDw] = useState(null);
    const h = D.home, he = loc === 'he';
    const cardH = (title, icon, right, body, extra) => e(Card, { title: tn(title, loc), icon, right, label: t(title, loc), style: Object.assign({ borderRadius: 20, padding: '18px 20px' }, extra) }, body);

    const readiness = e('section', { 'data-screen-label': 'Readiness', style: { gridColumn: 'span 2', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '20px 22px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { color: 'var(--brand)', display: 'flex' } }, e(Icon, { name: 'chart', size: 17, sw: 2 })), e('h3', { style: { font: '700 15px var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, tn(h.readinessTitle, loc))),
        e('a', { role: 'button', tabIndex: 0, onClick: () => navigate('equipment'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, font: '700 12.5px var(--font-sans)', color: 'var(--brand)', cursor: 'pointer' } }, tn(D.t.viewAll, loc), e(Icon, { name: 'chevron', size: 13, sw: 2.4, flip: he }))),
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' } },
        e('div', { style: { width: 150, height: 150, borderRadius: 999, background: h.donut, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
          e('div', { style: { width: 104, height: 104, borderRadius: 999, background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
            e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontSize: '1.9rem', fontWeight: 600, color: 'var(--foreground)', lineHeight: 1 } }, h.pct),
            e('span', { style: { font: '700 9px var(--font-sans)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-foreground)', marginTop: 3 } }, tn(h.ready, loc)))),
        e('div', { style: { flex: 1, minWidth: 230, display: 'flex', flexDirection: 'column', gap: 10 } },
          e('p', { style: Object.assign(muted('500 12.5px var(--font-sans)'), { margin: 0 }) }, tn(h.caption, loc)),
          e('div', { style: grid('1fr 1fr', { gap: '8px 20px' }) },
            h.legend.map((lg, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8 } },
              e('span', { style: { width: 9, height: 9, borderRadius: 3, background: lg.c, flexShrink: 0 } }),
              e('span', { style: { flex: 1, font: '500 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(lg.label, loc)),
              numSpan(lg.n)))))));

    const exceptions = e('section', { 'data-screen-label': 'Exceptions', style: { gridRow: 'span 2', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px 12px' } }, e('span', { style: { color: 'var(--status-issue-fg)', display: 'flex' } }, e(Icon, { name: 'alert', size: 16, sw: 2 })), e('h3', { style: { font: '700 15px var(--font-sans)', margin: 0, flex: 1, color: 'var(--foreground)' } }, tn(h.exTitle, loc)), e('span', { dir: 'ltr', style: { minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--status-issue-bg)', color: 'var(--status-issue-fg)', font: '700 11px var(--font-num)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, String(h.exceptions.length))),
      e('div', { style: { flex: 1, overflowY: 'auto' } }, h.exceptions.map((x, i) => {
        const c = x.sev === 'issue' ? 'rgb(var(--sys-red))' : x.sev === 'stale' ? 'rgb(var(--stale))' : 'rgb(var(--sys-orange))';
        return e('div', { key: i, role: 'button', tabIndex: 0, onClick: () => setDw(i), onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDw(i); } }, className: 'vt-row', style: { display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 18px', cursor: 'pointer', borderTop: '1px solid var(--border)' } },
          e('span', { style: { width: 9, height: 9, borderRadius: 999, background: c, flexShrink: 0, marginTop: 5 } }),
          e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { style: { font: '600 13px/1.4 var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(x.title, loc)), e('p', { style: { font: '500 11px var(--font-sans)', color: 'var(--muted-foreground)', margin: '2px 0 0' } }, tn(x.meta, loc))),
          e(Icon, { name: 'chevron', size: 15, sw: 2.2, color: 'var(--muted-foreground)', flip: he, style: { marginTop: 2 } }));
      })));

    const people = cardH(h.peopleTitle, 'users', null, e(React.Fragment, null,
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontSize: '1.7rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1 } }, h.onShift), e('span', { style: muted('500 12.5px var(--font-sans)') }, tn(h.ofStaff, loc))),
      e('div', { style: { display: 'flex', alignItems: 'center', paddingInlineStart: 8 } }, h.avatars[he ? 'h' : 'e'].map((a, i) => e('div', { key: i, style: { marginInlineStart: -8, border: '2px solid var(--surface)', borderRadius: 999 } }, e(Avatar, { brand: i === 0, size: 30 }, a))), e('span', { dir: 'ltr', style: Object.assign(muted('600 12px var(--font-num)'), { marginInlineStart: 8 }) }, h.more)),
      e('div', { style: { marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted('500 11.5px var(--font-sans)') }, tn(h.nextHandoff, loc)), !isLead && e('button', { type: 'button', onClick: () => navigate('people'), className: 'vt-btn vt-btn-link', style: { height: 32, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--brand)', font: '700 12px var(--font-sans)', cursor: 'pointer' } }, tn(h.manageRoles, loc)))), { minHeight: 150 });

    const inventory = cardH(h.invTitle, 'pkg', null, e(React.Fragment, null,
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)', fontSize: '1.7rem', fontWeight: 700, color: 'var(--status-issue-fg)', lineHeight: 1 } }, h.lowStock), e('span', { style: muted('500 12.5px var(--font-sans)') }, tn(h.below, loc))),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, h.invRows.map((r, i) => e('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, e('span', { style: muted() }, tn(r.l, loc)), e('span', { dir: 'ltr', style: { font: '600 12px var(--font-num)', color: 'var(--foreground)' } }, tn(r.v, loc))))),
      e('div', { style: { marginTop: 'auto' } }, !isLead ? e('button', { type: 'button', onClick: () => navigate('inventory'), className: 'vt-btn vt-btn-link', style: { height: 32, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--brand)', font: '700 12px var(--font-sans)', cursor: 'pointer' } }, tn(h.newRestock, loc)) : e('a', { role: 'button', tabIndex: 0, onClick: () => navigate('inventory'), style: { font: '700 12px var(--font-sans)', color: 'var(--brand)', cursor: 'pointer' } }, tn(D.t.viewAll, loc)))));

    const conn = cardH(h.connTitle, 'plug', null, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } }, h.connRows.map((r, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { style: { font: '600 12.5px var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(r.l, loc)), e('p', { style: { font: '500 11px var(--font-sans)', color: 'var(--muted-foreground)', margin: '1px 0 0' } }, tn(r.v, loc))), e(Pill, { st: r.st }, tn(r.s, loc))))));

    const opsCard = e(Card, { title: tn(h.opsTitle, loc), icon: 'activity', label: 'Ops Health', right: e('span', { style: { flexShrink: 0, padding: '2px 7px', borderRadius: 6, background: 'var(--tonal)', color: 'var(--muted-foreground)', font: '700 9px var(--font-sans)', letterSpacing: '.04em', textTransform: 'uppercase' } }, tn(D.t.frozen, loc)), style: { borderRadius: 20, padding: '18px 20px' } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } }, h.opsRows.map((r, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { flex: 1, font: '600 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(r.l, loc)), e(Pill, { st: r.st, dot: false }, tn(r.v, loc))))));

    const activity = e(Card, { title: tn(h.activityTitle, loc), icon: 'shield', label: 'Recent activity', right: e('a', { role: 'button', tabIndex: 0, onClick: () => navigate('audit'), style: { font: '700 11.5px var(--font-sans)', color: 'var(--brand)', cursor: 'pointer' } }, tn(D.t.viewAll, loc)), style: { gridColumn: 'span 2', borderRadius: 20, padding: '18px 20px' } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, h.activity.map((a, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' } }, e(Avatar, { brand: a.brand, size: 26 }, a.ini[he ? 'h' : 'e']), e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { style: { font: '500 12px/1.4 var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, e('strong', { style: { fontWeight: 700 } }, tn(a.actor, loc)), ' ', tn(a.action, loc), ' ', e('strong', { style: { fontWeight: 600 } }, tn(a.target, loc))), e('p', { dir: 'auto', style: { font: '500 10.5px var(--font-num)', color: 'var(--muted-foreground)', margin: '2px 0 0' } }, tn(a.when, loc)))))));

    const x = dw != null ? h.exceptions[dw] : null;
    const sevPill = x && (x.sev === 'issue' ? 'issue' : x.sev === 'stale' ? 'stale' : 'maint');
    const drawer = e(Drawer, { open: x != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: x && e(React.Fragment, null,
        !isLead && e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true, onClick: () => {} }, tn({ e: 'Resolve', h: 'סימון כטופל' }, loc)), e(Btn, { kind: 'ghost', onClick: () => {} }, tn({ e: 'Assign', h: 'הקצאה' }, loc))),
        e(Btn, { kind: 'link', onClick: () => { const to = x.to; setDw(null); navigate(to); } }, tn({ e: 'Open module', h: 'פתיחת מודול' }, loc), e(Icon, { name: 'chevron', size: 14, sw: 2.4, flip: he }))) },
      x && e(DrawerHead, { onClose: () => setDw(null) }, e(Pill, { st: sevPill, style: { marginBottom: 9 } }, tn(D.equipment.sevLabel[x.sev] || { e: x.sev, h: x.sev }, loc)), e('h3', { style: { font: '700 17px/1.35 var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, tn(x.title, loc))),
      x && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: grid('1fr 1fr', { gap: 14 }) },
          e(Field, { label: tn({ e: 'Source', h: 'מקור' }, loc) }, e(FieldVal, null, tn(D.title[x.to], loc))),
          e(Field, { label: tn({ e: 'First seen', h: 'אותר לראשונה' }, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, x.first)),
          e(Field, { label: tn({ e: 'Entity', h: 'ישות' }, loc) }, e(FieldVal, { dir: 'ltr', style: { font: '500 12.5px var(--font-num)' } }, x.entity)),
          e(Field, { label: tn({ e: 'Owner', h: 'אחראי' }, loc) }, e(FieldVal, null, tn(x.owner, loc)))),
        e('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 15 } }, e(Field, { label: tn({ e: 'Detail', h: 'פירוט' }, loc) }, e('p', { style: { font: '400 13.5px/1.6 var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(x.body, loc)))),
        isLead && e(LeadNote, null, tn({ e: 'Resolution and assignment require an admin. You can open the source module to review.', h: 'טיפול והקצאה דורשים מנהל. ניתן לפתוח את מודול המקור לעיון.' }, loc))));

    return e('div', null, e('div', { 'data-bento': true, style: grid('1fr 1fr 1fr', { gridAutoRows: 'minmax(150px,auto)' }) }, readiness, exceptions, people, inventory, conn, opsCard, activity), drawer);
  }

  // ============ PEOPLE ============
  function People({ loc, isLead }) {
    const P = D.people, he = loc === 'he';
    const [tab, setTab] = useState('users');
    const [dw, setDw] = useState(null);
    const primary = !isLead && e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' }, onClick: () => {} }, tn(tab === 'users' ? P.invite : P.editRoster, loc));

    const usersTable = e(Table, { cols: P.cols.map((c) => tn(c, loc)).concat('') },
      P.users.map((u, i) => {
        const rm = P.roleMeta[u.role], sm = P.statusMeta[u.status];
        return e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
          e(TD, null, e('div', { style: { display: 'flex', alignItems: 'center', gap: 11 } }, e(Avatar, { brand: i === 0, size: 34 }, u.ini[he ? 'h' : 'e']), e('div', { style: { minWidth: 0 } }, e('p', { style: { font: '600 13.5px var(--font-sans)', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap' } }, tn(u.name, loc)), e('p', { dir: 'ltr', style: { font: '500 11px var(--font-num)', color: 'var(--muted-foreground)', margin: '1px 0 0' } }, u.email)))),
          e(TD, null, e(DotChip, { color: rm.dot }, tn(rm.label, loc))),
          e(TD, null, e(Pill, { st: sm.st }, tn(sm.label, loc))),
          e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(u.last, loc))));
      }));

    const shiftBg = { ok: ['var(--status-ok-bg)', 'var(--status-ok-fg)'], steril: ['var(--status-steril-bg)', 'var(--status-steril-fg)'], brand: ['var(--brand-soft)', 'var(--brand)'] };
    const roster = e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', overflow: 'hidden' } },
      e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        e('thead', null, e('tr', null, e('th', { style: { textAlign: 'start', padding: '12px 18px', font: '700 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)' } }, tn(P.staffHead, loc)), P.rosterHead.map((d, i) => e('th', { key: i, style: { textAlign: 'center', padding: '10px', borderBottom: '1px solid var(--border)' } }, e('div', { style: { font: '700 12px var(--font-sans)', color: 'var(--foreground)' } }, tn(d[0], loc)), e('div', { dir: 'ltr', style: { font: '500 10.5px var(--font-num)', color: 'var(--muted-foreground)' } }, d[1]))))),
        e('tbody', null, P.roster.map((r, i) => { const u = P.users[r.u]; const rm = P.roleMeta[u.role]; return e('tr', { key: i },
          e('td', { style: { padding: '11px 18px', borderTop: '1px solid var(--hairline)' } }, e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, e(Avatar, { brand: r.u === 0, size: 30 }, u.ini[he ? 'h' : 'e']), e('div', { style: { minWidth: 0 } }, e('p', { style: { font: '600 12.5px var(--font-sans)', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap' } }, tn(u.name, loc)), e('p', { style: { font: '500 10.5px var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 } }, tn(rm.label, loc))))),
          r.cells.map((c, j) => { const sm = P.shiftMeta[c]; const col = shiftBg[sm.st]; return e('td', { key: j, style: { padding: '9px 8px', borderTop: '1px solid var(--hairline)', textAlign: 'center' } }, c === 'off' ? e('span', { style: { font: '500 13px var(--font-num)', color: 'var(--muted-foreground)' } }, '—') : e('span', { style: { display: 'inline-block', padding: '4px 10px', borderRadius: 8, background: col[0], color: col[1], font: '600 11px var(--font-sans)', whiteSpace: 'nowrap' } }, tn(sm.label, loc))); })); }))));

    const u = dw != null ? P.users[dw] : null; const rm = u && P.roleMeta[u.role]; const sm = u && P.statusMeta[u.status]; const shm = u && P.shiftMeta[u.shift];
    const dd = P.drawer;
    const drawer = e(Drawer, { open: u != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: u && e(React.Fragment, null, !isLead && e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true }, tn(dd.save, loc)), e(Btn, { kind: 'danger' }, tn(dd.deactivate, loc))), e(Btn, { kind: 'link', onClick: () => setDw(null) }, tn(dd.viewAudit, loc), e(Icon, { name: 'chevron', size: 14, sw: 2.4, flip: he }))) },
      u && e(DrawerHead, { onClose: () => setDw(null) },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } }, e(Avatar, { brand: true, size: 44 }, u.ini[he ? 'h' : 'e']), e('div', { style: { flex: 1, minWidth: 0 } }, e('h3', { style: { font: '700 17px var(--font-sans)', margin: '0 0 4px', color: 'var(--foreground)', whiteSpace: 'nowrap' } }, tn(u.name, loc)), e(DotChip, { color: rm.dot }, tn(rm.label, loc))))),
      u && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: grid('1fr 1fr', { gap: '16px 14px' }) },
          e(Field, { label: tn(dd.role, loc) }, isLead ? e(FieldVal, { style: { font: '600 13.5px var(--font-sans)' } }, tn(rm.label, loc)) : e('button', { type: 'button', className: 'vt-select', style: { width: '100%', height: 38, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 } }, e('span', { style: { flex: 1, textAlign: 'start', font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(rm.label, loc)), e(Icon, { name: 'chevrable', size: 14, sw: 2, color: 'var(--muted-foreground)' }))),
          e(Field, { label: tn(dd.status, loc) }, e(Pill, { st: sm.st, style: { padding: '4px 10px', font: '600 12px var(--font-sans)' } }, tn(sm.label, loc))),
          e(Field, { label: tn(dd.shift, loc) }, e(FieldVal, { style: { font: '600 13.5px var(--font-sans)' } }, tn(shm.label, loc))),
          e(Field, { label: tn(dd.last, loc) }, e(FieldVal, { dir: 'auto', style: { fontFamily: 'var(--font-num)' } }, tn(u.last, loc))),
          e(Field, { label: tn(dd.email, loc), span: true }, e(FieldVal, { dir: 'ltr', style: { font: '500 13px var(--font-num)' } }, u.email)),
          e(Field, { label: tn(dd.since, loc) }, e(FieldVal, { dir: 'auto' }, tn(u.since, loc)))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null,
      e(PrimaryRow, { tabsEl: e(Tabs, { items: P.tabs, value: tab, onChange: (v) => { setTab(v); setDw(null); }, loc }), action: tab === 'users' ? primary : (!isLead && e(Btn, { kind: 'primary', icon: 'calendar', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(P.editRoster, loc))) }),
      tab === 'users' ? usersTable : roster)), drawer);
  }

  // ============ EQUIPMENT ============
  function Equipment({ loc, isLead }) {
    const E = D.equipment, he = loc === 'he';
    const [tab, setTab] = useState('types');
    const [dw, setDw] = useState(null);
    const prim = !isLead && e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(tab === 'types' ? E.newType : tab === 'docks' ? E.addDock : E.newRule, loc));
    const tabs = e(Tabs, { items: E.tabs, value: tab, onChange: (v) => { setTab(v); setDw(null); }, loc });

    const types = e(Table, { cols: E.typeCols.map((c) => tn(c, loc)) }, E.types.map((a, i) => e('tr', { key: i, className: 'vt-row' },
      e(TD, { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(a.name, loc)), e(TD, { style: muted('500 12.5px var(--font-sans)') }, tn(a.cat, loc)), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, a.n)), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'auto' }, tn(a.rule, loc))))));

    const docks = e(Table, { cols: E.dockCols.map((c) => tn(c, loc)) }, E.docks.map((d, i) => e('tr', { key: i, className: 'vt-row' },
      e(TD, { style: { font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, d.name)), e(TD, { style: { font: '500 12.5px var(--font-sans)', color: 'var(--foreground)' } }, tn(d.loc, loc)), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'ltr' }, d.r)), e(TD, null, e(Pill, { st: d.st }, tn(d.s, loc))), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(d.sync, loc))))));

    const rules = e(Table, { cols: E.ruleCols.map((c) => tn(c, loc)).concat('') }, E.rules.map((r, i) => e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
      e(TD, { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(r.name, loc)), e(TD, { style: muted() }, tn(r.applies, loc)), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, r.window)), e(TD, null, e(Pill, { st: r.st }, tn(r.s, loc))))));

    const r = dw != null ? E.rules[dw] : null; const dd = E.drawer;
    const drawer = e(Drawer, { open: r != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr',
      footer: r && (isLead ? e(Btn, { kind: 'ghost', flex: true, onClick: () => setDw(null) }, tn(D.t.close, loc)) : e(React.Fragment, null, e(Btn, { kind: 'primary', flex: true }, tn(dd.save, loc)), e(Btn, { kind: 'ghost' }, tn(r.st === 'unknown' ? { e: 'Resume', h: 'חידוש' } : { e: 'Pause', h: 'השהיה' }, loc)))) },
      r && e(DrawerHead, { onClose: () => setDw(null) }, e('p', { style: { font: '600 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: '0 0 5px' } }, tn(dd.kind, loc)), e('h3', { style: { font: '700 17px/1.35 var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, tn(r.name, loc))),
      r && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e(Field, { label: tn(dd.status, loc) }, e(Pill, { st: r.st, style: { padding: '4px 10px', font: '600 12px var(--font-sans)' } }, tn(r.s, loc))),
        e(Field, { label: tn(dd.applies, loc) }, e(FieldVal, null, tn(r.applies, loc))),
        e('div', { style: grid('1fr 1fr', { gap: '16px 14px' }) },
          e(Field, { label: tn(dd.window, loc) }, isLead ? e(FieldVal, { dir: 'ltr', style: { font: '600 13.5px var(--font-num)' } }, r.window) : e('button', { type: 'button', className: 'vt-select', style: selectStyle() }, e('span', { dir: 'ltr', style: { flex: 1, textAlign: 'start', font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, r.window), e(Icon, { name: 'chevrable', size: 14, sw: 2, color: 'var(--muted-foreground)' }))),
          e(Field, { label: tn(dd.grace, loc) }, isLead ? e(FieldVal, { dir: 'ltr', style: { font: '600 13.5px var(--font-num)' } }, r.grace) : e('button', { type: 'button', className: 'vt-select', style: selectStyle() }, e('span', { dir: 'ltr', style: { flex: 1, textAlign: 'start', font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, r.grace), e(Icon, { name: 'chevrable', size: 14, sw: 2, color: 'var(--muted-foreground)' }))),
          e(Field, { label: tn(dd.sev, loc) }, e(Pill, { st: r.sev, dot: false, style: { padding: '4px 10px', font: '600 12px var(--font-sans)' } }, tn(E.sevLabel[r.sev], loc))),
          e(Field, { label: tn(dd.owner, loc) }, e(FieldVal, null, tn(r.owner, loc)))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null, e(PrimaryRow, { tabsEl: tabs, action: prim }), tab === 'types' ? types : tab === 'docks' ? docks : rules)), drawer);
  }
  function selectStyle() { return { width: '100%', height: 38, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }; }

  // ============ INVENTORY ============
  function Inventory({ loc, isLead }) {
    const I = D.inventory, he = loc === 'he';
    const [tab, setTab] = useState('restock');
    const [dw, setDw] = useState(null);
    const prim = !isLead && (tab !== 'low') && e(Btn, { kind: 'primary', icon: 'plus', style: { height: 38, borderRadius: 11, font: '700 13px var(--font-sans)' } }, tn(tab === 'po' ? I.newPo : I.newRestock, loc));
    const tabs = e(Tabs, { items: I.tabs, value: tab, onChange: (v) => { setTab(v); setDw(null); }, loc });

    const restock = e(Table, { cols: I.rstCols.map((c) => tn(c, loc)).concat('') }, I.restock.map((r, i) => { const sm = I.rstStatus[r.status]; return e(Row, { key: i, onClick: () => setDw(i), chevron: true, dir: he ? 'rtl' : 'ltr' },
      e(TD, null, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } }, e('span', { dir: 'ltr', style: { font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, r.id), e('span', { style: muted() }, tn(r.loc, loc)))),
      e(TD, null, e(Pill, { st: sm.st }, tn(sm.s, loc))), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'ltr' }, r.counted)), e(TD, { style: { font: '500 12.5px var(--font-sans)', color: 'var(--foreground)', whiteSpace: 'nowrap' } }, tn(r.by, loc)), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(r.upd, loc)))); }));

    const po = e(Table, { cols: I.poCols.map((c) => tn(c, loc)) }, I.po.map((p, i) => { const sm = I.poStatus[p.status]; return e('tr', { key: i, className: 'vt-row' },
      e(TD, null, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } }, e('span', { dir: 'ltr', style: { font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, p.id), e('span', { dir: 'ltr', style: muted() }, p.vendor))),
      e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, p.items)), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, p.total)), e(TD, null, e(Pill, { st: sm.st }, tn(sm.s, loc))), e(TD, { style: { font: '500 12px var(--font-num)', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, e('span', { dir: 'auto' }, tn(p.created, loc)))); }));

    const low = e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', overflow: 'hidden' } },
      e(Table, { cols: I.lowCols.map((c) => tn(c, loc)).concat('') }, I.low.map((l, i) => e('tr', { key: i, className: 'vt-row' },
        e(TD, { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)' } }, tn(l.name, loc)), e(TD, { style: { font: '500 12.5px var(--font-num)', color: 'var(--muted-foreground)' } }, e('span', { dir: 'ltr' }, l.par)), e(TD, { style: { font: '600 12.5px var(--font-num)', color: 'var(--foreground)' } }, e('span', { dir: 'ltr' }, l.hand)), e(TD, null, e('span', { dir: 'ltr', style: { font: '700 12.5px var(--font-num)', color: 'var(--status-issue-fg)' } }, '−' + l.short)), e(TD, null, !isLead && e('button', { type: 'button', className: 'vt-btn vt-btn-link', style: { height: 30, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--brand)', font: '700 11.5px var(--font-sans)', cursor: 'pointer', whiteSpace: 'nowrap' } }, tn(I.addRestock, loc)))))),
      e('div', { style: { padding: '11px 18px', borderTop: '1px solid var(--hairline)', font: '500 12px var(--font-sans)', color: 'var(--muted-foreground)' } }, tn(I.lowMore, loc)));

    const r = dw != null ? I.restock[dw] : null; const dd = I.drawer; const step = r ? I.stepIdx[r.status] : 1;
    const stepper = r && e('div', { style: { display: 'flex', alignItems: 'center', gap: 7, padding: '14px 20px', borderBottom: '1px solid var(--border)', overflowX: 'auto' } },
      I.steps.map((lab, i) => { const n = i + 1; const done = n < step, cur = n === step; return e(React.Fragment, { key: i },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
          done ? e('span', { style: { width: 22, height: 22, borderRadius: 999, background: 'var(--brand)', color: 'var(--brand-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e(Icon, { name: 'check', size: 12, sw: 3 })) : e('span', { dir: 'ltr', style: { width: 22, height: 22, borderRadius: 999, background: cur ? 'var(--surface)' : 'var(--tonal)', border: cur ? '2px solid var(--brand)' : 'none', color: cur ? 'var(--brand)' : 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 11px var(--font-num)' } }, String(n)),
          e('span', { style: { font: (cur ? 700 : 500) + ' 12px var(--font-sans)', color: cur ? 'var(--foreground)' : 'var(--muted-foreground)', whiteSpace: 'nowrap' } }, tn(lab, loc))),
        i < 2 && e('span', { style: { width: 16, height: 2, background: 'var(--border)', flexShrink: 0 } })); }));
    const primaryLabel = step === 1 ? I.primaryStep[0] : step === 2 ? I.primaryStep[1] : (r && r.status === 'received' ? I.completed : I.primaryStep[2]);
    const drawer = e(Drawer, { open: r != null, onClose: () => setDw(null), dir: he ? 'rtl' : 'ltr', width: 420,
      footer: r && (isLead ? e(Btn, { kind: 'ghost', flex: true, onClick: () => setDw(null) }, tn(D.t.close, loc)) : e(React.Fragment, null, r.status !== 'received' && e(Btn, { kind: 'ghost' }, tn(dd.saveDraft, loc)), e(Btn, { kind: 'primary', flex: true, disabled: r.status === 'received' }, tn(primaryLabel, loc)))) },
      r && e(DrawerHead, { onClose: () => setDw(null) }, e('span', { dir: 'ltr', style: { font: '600 11px var(--font-num)', color: 'var(--muted-foreground)' } }, r.id), e('h3', { style: { font: '700 17px var(--font-sans)', margin: '2px 0 0', color: 'var(--foreground)' } }, tn({ e: 'Restock', h: 'חידוש' }, loc) + ' · ' + tn(r.loc, loc))),
      stepper,
      r && e('div', { style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: grid('1fr 1fr', { gap: 14 }) },
          e(Field, { label: tn(dd.loc, loc) }, e(FieldVal, null, tn(r.loc, loc))), e(Field, { label: tn(dd.progress, loc) }, e(FieldVal, { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, r.counted)),
          e(Field, { label: tn(dd.by, loc) }, e(FieldVal, null, tn(r.by, loc))), e(Field, { label: tn(dd.upd, loc) }, e(FieldVal, { dir: 'auto', style: { fontFamily: 'var(--font-num)' } }, tn(r.upd, loc)))),
        e('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 15 } },
          e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 } }, e('p', { style: { font: '600 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: 0 } }, tn(dd.countTitle, loc)), e('span', { style: muted('500 11px var(--font-sans)') }, tn(dd.vsPar, loc))),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } }, I.countItems.map((c, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10 } },
            e('div', { style: { flex: 1, minWidth: 0 } }, e('p', { style: { font: '600 13px var(--font-sans)', color: 'var(--foreground)', margin: 0 } }, tn(c.name, loc)), e('p', { style: { font: '500 11px var(--font-sans)', color: 'var(--muted-foreground)', margin: '1px 0 0' } }, tn(dd.par, loc), ' ', e('span', { dir: 'ltr', style: { fontFamily: 'var(--font-num)' } }, c.par))),
            isLead ? e('span', { dir: 'ltr', style: { minWidth: 44, textAlign: 'center', font: '600 14px var(--font-num)', color: 'var(--foreground)' } }, String(c.cnt)) : e(Counter, { value: c.cnt }))))),
        isLead && e(LeadNote, null, tn(dd.leadNote, loc))));

    return e('div', null, wrap(e(React.Fragment, null, e(PrimaryRow, { tabsEl: tabs, action: prim }), tab === 'restock' ? restock : tab === 'po' ? po : low)), drawer);
  }
  function Counter({ value }) {
    const [n, setN] = useState(value);
    const btn = { width: 30, height: 30, border: 'none', background: 'var(--surface)', color: 'var(--foreground)', font: '600 16px var(--font-sans)', cursor: 'pointer' };
    return e('div', { style: { display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', flexShrink: 0 } },
      e('button', { type: 'button', className: 'vt-step', onClick: () => setN((x) => Math.max(0, x - 1)), style: btn }, '−'),
      e('span', { dir: 'ltr', style: { minWidth: 38, textAlign: 'center', font: '600 13px var(--font-num)', color: 'var(--foreground)' } }, String(n)),
      e('button', { type: 'button', className: 'vt-step', onClick: () => setN((x) => x + 1), style: Object.assign({}, btn, { borderInlineStart: '1px solid var(--border)' }) }, '+'));
  }

  window.MODULES = { Home, People, Equipment, Inventory };
})();
