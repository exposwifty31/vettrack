/* VetTrack Console — shared UI primitives. Exposes window.UI. Requires React (global). */
(function () {
  const e = React.createElement;

  // resolve a {e,h} pair or raw string
  const t = (v, loc) => (v == null ? '' : (typeof v === 'string' || typeof v === 'number' ? v : (loc === 'he' ? v.h : v.e)));
  // isolate digit runs so numbers order correctly inside RTL text
  const N = (v) => String(v).replace(/(\d[\d.,:%\-\u2013]*)/g, '\u2068$1\u2069');
  const tn = (v, loc) => (loc === 'he' ? N(t(v, loc)) : t(v, loc));

  const STATUS = {
    ok: ['var(--status-ok-bg)', 'var(--status-ok-fg)'],
    issue: ['var(--status-issue-bg)', 'var(--status-issue-fg)'],
    maint: ['var(--status-maint-bg)', 'var(--status-maint-fg)'],
    steril: ['var(--status-steril-bg)', 'var(--status-steril-fg)'],
    stale: ['var(--status-stale-bg)', 'var(--status-stale-fg)'],
    unknown: ['var(--status-unknown-bg)', 'var(--status-unknown-fg)'],
  };

  const ICONS = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    pkg: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M7 8h10v3a5 5 0 0 1-10 0Z"/><path d="M12 16v6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    chevrable: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    retry: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 9h6"/><path d="M12 6v6"/><path d="M9 21v-4h6v4"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    truck: '<path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    rule: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    dock: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10"/><path d="M12 16v4"/>',
    pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  };

  function Icon({ name, size = 18, sw = 1.8, color = 'currentColor', style, flip }) {
    return e('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
      strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      style: Object.assign({ display: 'block', flexShrink: 0 }, flip ? { transform: 'scaleX(-1)' } : null, style),
      dangerouslySetInnerHTML: { __html: ICONS[name] || '' },
    });
  }

  function Pill({ st = 'unknown', children, dot = true, mono, style }) {
    const [bg, fg] = STATUS[st] || STATUS.unknown;
    return e('span', { style: Object.assign({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: bg, color: fg, font: (mono ? '600 11px var(--font-num)' : '600 11px var(--font-sans)'), whiteSpace: 'nowrap' }, style) },
      dot && e('span', { style: { width: 6, height: 6, borderRadius: 999, background: 'currentColor' } }),
      children);
  }

  function DotChip({ color, children }) {
    return e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--tonal)', color: 'var(--foreground)', font: '600 11.5px var(--font-sans)', whiteSpace: 'nowrap' } },
      e('span', { style: { width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 } }), children);
  }

  function Avatar({ children, brand, size = 30, ltr = true }) {
    return e('div', { dir: ltr ? 'ltr' : undefined, style: { width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 ${Math.round(size * 0.36)}px var(--font-sans)`, background: brand ? 'var(--brand)' : 'var(--tonal)', color: brand ? 'var(--brand-foreground)' : 'var(--foreground)' } }, children);
  }

  // Card shell
  function Card({ title, icon, right, children, pad = '18px 20px', style, label }) {
    return e('section', { 'data-screen-label': label, style: Object.assign({ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column', gap: 12, padding: pad }, style) },
      (title || right) && e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        icon && e('span', { style: { color: 'var(--brand)', display: 'flex' } }, e(Icon, { name: icon, size: 16, sw: 1.9 })),
        title && e('h3', { style: { font: '700 14.5px var(--font-sans)', margin: 0, flex: 1, color: 'var(--foreground)' } }, title),
        right),
      children);
  }

  // generic table
  function Table({ cols, children, dir }) {
    const th = { textAlign: 'start', padding: '12px 18px', font: '700 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)' };
    return e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', overflow: 'hidden' } },
      e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        e('thead', null, e('tr', null,
          cols.map((c, i) => e('th', { key: i, style: c === '' ? { width: 34, borderBottom: '1px solid var(--border)' } : th }, c)))),
        e('tbody', null, children)));
  }
  function TD(props) {
    props = props || {};
    var style = props.style, children = props.children, rest = {};
    for (var k in props) { if (k !== 'style' && k !== 'children') rest[k] = props[k]; }
    return e('td', Object.assign({ style: Object.assign({ padding: '11px 18px', borderTop: '1px solid var(--hairline)' }, style) }, rest), children);
  }
  function Row({ onClick, children, chevron, dir }) {
    var kids = React.Children.toArray(children);
    if (chevron) kids.push(e('td', { key: '_chev', style: { padding: '11px 14px', borderTop: '1px solid var(--hairline)' } }, e(Icon, { name: 'chevron', size: 15, sw: 2.2, color: 'var(--muted-foreground)', flip: dir === 'rtl' })));
    return e('tr', {
      onClick, tabIndex: onClick ? 0 : undefined, role: onClick ? 'button' : undefined,
      onKeyDown: onClick ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(ev); } } : undefined,
      className: 'vt-row', style: { cursor: onClick ? 'pointer' : 'default' },
    }, kids);
  }

  // right-side drawer
  function Drawer({ open, onClose, dir, children, footer, width = 410 }) {
    if (!open) return null;
    return e(React.Fragment, null,
      e('div', { onClick: onClose, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 80, animation: 'vt-fade .18s ease' } }),
      e('aside', { dir, style: { position: 'fixed', insetBlock: 0, insetInlineEnd: 0, width, maxWidth: '94%', background: 'var(--surface)', borderInlineStart: '1px solid var(--border)', boxShadow: 'var(--shadow-overlay)', zIndex: 90, display: 'flex', flexDirection: 'column', animation: 'vt-slide .24s cubic-bezier(0.2,0,0,1)' } },
        children,
        footer && e('div', { style: { borderTop: '1px solid var(--border)', padding: '14px 20px', display: 'flex', gap: 10, flexWrap: 'wrap' } }, footer)));
  }
  function DrawerHead({ children, onClose }) {
    return e('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 20px', borderBottom: '1px solid var(--border)' } },
      e('div', { style: { flex: 1, minWidth: 0 } }, children),
      e('button', { type: 'button', onClick: onClose, 'aria-label': 'Close', className: 'vt-iconbtn', style: { width: 32, height: 32, borderRadius: 9, border: 'none', background: 'var(--background)', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, e(Icon, { name: 'x', size: 16, sw: 2.2 })));
  }
  function Field({ label, children, span }) {
    return e('div', { style: span ? { gridColumn: 'span 2' } : null },
      e('p', { style: { font: '600 10px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: '0 0 5px' } }, label),
      children);
  }
  function FieldVal(props) {
    props = props || {};
    var style = props.style, children = props.children, rest = {};
    for (var k in props) { if (k !== 'style' && k !== 'children') rest[k] = props[k]; }
    return e('p', Object.assign({ style: Object.assign({ font: '600 13px var(--font-sans)', color: 'var(--foreground)', margin: 0 }, style) }, rest), children);
  }

  // primary / secondary buttons
  function Btn({ kind = 'primary', onClick, children, icon, style, flex, disabled, dir }) {
    const base = { height: 42, padding: '0 16px', borderRadius: 13, font: '700 13.5px var(--font-sans)', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none', flex: flex ? 1 : undefined, minWidth: flex ? 120 : undefined };
    const styles = {
      primary: { background: disabled ? 'var(--tonal)' : 'var(--brand)', color: disabled ? 'var(--muted-foreground)' : 'var(--brand-foreground)' },
      ghost: { background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)' },
      link: { background: 'var(--surface)', color: 'var(--brand)', border: '1px solid var(--border)' },
      danger: { background: 'var(--surface)', color: 'var(--status-issue-fg)', border: '1px solid var(--status-issue-border)' },
    };
    return e('button', { type: 'button', onClick: disabled ? undefined : onClick, disabled, className: 'vt-btn vt-btn-' + kind, style: Object.assign(base, styles[kind], style) },
      icon && e(Icon, { name: icon, size: 15, sw: 2, flip: false }), children);
  }

  function LeadNote({ children }) {
    return e('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--brand-soft)', border: '1px solid var(--brand-border)', borderRadius: 12, padding: '12px 14px' } },
      e(Icon, { name: 'lock', size: 15, sw: 2, color: 'var(--brand)', style: { marginTop: 1 } }),
      e('span', { style: { font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--brand-ink)' } }, children));
  }

  // tabs (segmented)
  function Tabs({ items, value, onChange, loc }) {
    return e('div', { style: { display: 'flex', gap: 4, padding: 4, background: 'var(--tonal)', borderRadius: 12 } },
      items.map((it) => {
        const active = value === it[0];
        return e('button', { key: it[0], type: 'button', onClick: () => onChange(it[0]), className: 'vt-tab', style: { border: 'none', cursor: 'pointer', padding: '7px 15px', borderRadius: 9, font: (active ? 700 : 500) + ' 13px var(--font-sans)', background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--foreground)' : 'var(--muted-foreground)', boxShadow: active ? '0 1px 2px rgba(0,0,0,.12)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 7 } },
          tn(it[1], loc),
          it[2] ? e('span', { dir: 'ltr', style: { minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: active ? 'var(--brand-soft)' : 'var(--tonal)', color: active ? 'var(--brand)' : 'var(--muted-foreground)', font: '700 10.5px var(--font-num)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, it[2]) : null);
      }));
  }

  // simple state views
  function Empty({ icon, title, body, cta }) {
    return e('div', { style: { maxWidth: 540, margin: '64px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } },
      e('div', { style: { width: 62, height: 62, borderRadius: 17, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e(Icon, { name: icon, size: 28, sw: 1.8 })),
      e('h2', { style: { font: '700 21px var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, title),
      e('p', { style: { font: '400 14px/1.6 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0, maxWidth: 420 } }, body),
      cta);
  }
  function ErrorView({ title, body, code, onRetry, retry }) {
    return e('div', { style: { maxWidth: 460, margin: '64px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } },
      e('div', { style: { width: 56, height: 56, borderRadius: 999, background: 'var(--status-issue-bg)', color: 'var(--status-issue-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e(Icon, { name: 'alert', size: 26, sw: 2 })),
      e('h2', { style: { font: '700 20px var(--font-sans)', margin: 0, color: 'var(--foreground)' } }, title),
      e('p', { style: { font: '400 14px/1.55 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 } }, body),
      e(Btn, { kind: 'primary', icon: 'retry', onClick: onRetry, style: { borderRadius: 14 } }, retry),
      e('span', { dir: 'ltr', style: { font: '500 11.5px var(--font-num)', color: 'var(--muted-foreground)' } }, code));
  }
  function Skeleton({ style }) { return e('div', { className: 'skd', style: Object.assign({ borderRadius: 16 }, style) }); }

  window.UI = { e, t, tn, N, STATUS, ICONS, Icon, Pill, DotChip, Avatar, Card, Table, TD, Row, Drawer, DrawerHead, Field, FieldVal, Btn, LeadNote, Tabs, Empty, ErrorView, Skeleton };
})();
