import React, { useState, useEffect, useCallback } from 'react';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SHEET_ID = '1yopN8O-uwsCkYhevSmGnGaLPTHGcOjyHhRDtn3ranTo';
const API_KEY  = 'AIzaSyDepLhTVDuWyogq7Zj9lLFUG2K9-0B_gHU';
const REFRESH_MS = 5 * 60 * 1000;

// Semana del mes: día 1-7 = W1, 8-14 = W2, 15-21 = W3, 22+ = W4
function getCurrentWeek() {
  return 'W' + Math.ceil(new Date().getDate() / 7);
}

// Grupos y metas base (mensuales)
const GROUPS = {
  ventasStgo: {
    label: 'Ventas Santiago',
    tipo: 'Ventas',
    color: '#3b82f6',
    metaMensual: 38,
    execs: {
      '11599928': { nombre: 'Pedro Pinto',    meta: 19 },
      '8935167':  { nombre: 'Javier Herrera', meta: 19 },
    },
  },
  ventasVina: {
    label: 'Ventas Viña',
    tipo: 'Ventas',
    color: '#8b5cf6',
    metaMensual: 18,
    execs: {
      '13188552': { nombre: 'Tomas Paredes', meta: 9 },
      '13188544': { nombre: 'Victor Toledo', meta: 9 },
    },
  },
  consStgo: {
    label: 'Consignas Santiago',
    tipo: 'Consignas',
    color: '#10b981',
    metaMensual: 55,
    execs: {
      '14722736': { nombre: 'Tomas Leiva',         meta: 18 },
      '15277292': { nombre: 'Francisca Rodriguez', meta: 18 },
      '13804760': { nombre: 'Matias Peters',        meta: 18 },
    },
  },
  consVina: {
    label: 'Consignas Viña',
    tipo: 'Consignas',
    color: '#f59e0b',
    metaMensual: 25,
    execs: {
      '14268040': { nombre: 'Yana Nava', meta: 25 },
    },
  },
};

// ─── SHEETS FETCHER ─────────────────────────────────────────────────────────
async function fetchSheet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet error: ${res.status}`);
  const json = await res.json();
  return json.values || [];
}

// ─── PARSERS ────────────────────────────────────────────────────────────────
function parseConvData(rows) {
  // Dashboard Data - Mensajes: Fecha, Ejecutivo ID, Leads Conversados, Nombre
  const byDate = {};
  rows.slice(1).forEach(([fecha, execId, leads]) => {
    if (!fecha || !execId) return;
    const key = normDate(fecha.trim());
    if (!byDate[key]) byDate[key] = {};
    byDate[key][execId.trim()] = parseInt(leads) || 0;
  });
  return byDate;
}

// Normaliza "6/06/2026" → "06/06/2026"
function normDate(raw) {
  if (!raw) return '';
  const p = raw.trim().split('/');
  if (p.length !== 3) return raw.trim();
  return `${p[0].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[2]}`;
}
function dateKey(d) {
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}
function todayKey()     { return dateKey(new Date()); }
function yesterdayKey() { const d = new Date(); d.setDate(d.getDate()-1); return dateKey(d); }

function getConvForPeriod(byDate, tab) {
  const keys = Object.keys(byDate);
  if (tab === 'hoy')   return byDate[todayKey()]     || {};
  if (tab === 'ayer')  return byDate[yesterdayKey()] || {};
  if (tab === 'semana') {
    const merged = {};
    keys.forEach(k => {
      Object.entries(byDate[k] || {}).forEach(([id, v]) => {
        merged[id] = (merged[id] || 0) + v;
      });
    });
    // Filtra a los últimos 7 días
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const weekMerged = {};
    keys.forEach(k => {
      const [d,m,y] = k.split('/').map(Number);
      const kd = new Date(y, m-1, d);
      if (kd >= cutoff) {
        Object.entries(byDate[k] || {}).forEach(([id, v]) => {
          weekMerged[id] = (weekMerged[id] || 0) + v;
        });
      }
    });
    return weekMerged;
  }
  // mes: todo
  const all = {};
  keys.forEach(k => {
    Object.entries(byDate[k] || {}).forEach(([id, v]) => {
      all[id] = (all[id] || 0) + v;
    });
  });
  return all;
}

function parseVentasConsignas(ventasRows, consRows) {
  const week = getCurrentWeek();
  const result = {
    ventasStgo:  {},
    ventasVina:  {},
    consStgo:    {},
    consVina:    {},
    ventasStgoMes: {},
    ventasVinaMes: {},
    consStgoMes:   {},
    consVinaMes:   {},
  };

  // Mapa explícito de alias del Sheets → ID ejecutivo
  const ALIAS_MAP = {
    // Ventas Santiago
    'pedro p.':    '11599928',
    'pedro p':     '11599928',
    'pedro pinto': '11599928',
    'javier h.':   '8935167',
    'javier h':    '8935167',
    'javier herrera': '8935167',
    // Ventas Viña
    'victor t.':   '13188544',
    'victor t':    '13188544',
    'victor toledo': '13188544',
    'tomas p.':    '13188552',
    'tomas p':     '13188552',
    'tomas paredes': '13188552',
    // Consignas Santiago
    'matias p.':   '13804760',
    'matias p':    '13804760',
    'matias peters': '13804760',
    'francisca r.': '15277292',
    'francisca r':  '15277292',
    'francisca rodriguez': '15277292',
    'francisca':   '15277292',
    'tomas l.':    '14722736',
    'tomas l':     '14722736',
    'tomas leiva': '14722736',
    // Consignas Viña
    'yana n.':     '14268040',
    'yana n':      '14268040',
    'yana nava':   '14268040',
  };

  function resolveId(rawName) {
    if (!rawName) return null;
    const n = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
    return ALIAS_MAP[n] || null;
  }

  // Ventas — columnas: SUCURSAL, Vendedor, COUNTA PPU y también Semana/COUNTA a la derecha
  let curSuc = 'Santiago';
  ventasRows.forEach(row => {
    const suc = (row[0] || '').trim();
    const vend = (row[1] || '').trim();
    const cnt = parseInt(row[2]) || 0;
    const semLabel = (row[5] || '').trim(); // W1, W2...
    const semCnt = parseInt(row[6]) || 0;

    if (suc) curSuc = suc.includes('iña') ? 'Vina' : 'Santiago';
    const id = resolveId(vend);
    if (!id) return;

    if (curSuc === 'Santiago') {
      result.ventasStgoMes[id] = (result.ventasStgoMes[id] || 0) + cnt;
      if (semLabel === week) result.ventasStgo[id] = (result.ventasStgo[id] || 0) + semCnt;
    } else {
      result.ventasVinaMes[id] = (result.ventasVinaMes[id] || 0) + cnt;
      if (semLabel === week) result.ventasVina[id] = (result.ventasVina[id] || 0) + semCnt;
    }
  });

  // Consignaciones
  let curSuc2 = 'Santiago';
  consRows.forEach(row => {
    const suc = (row[0] || '').trim();
    const cons = (row[1] || '').trim();
    const cnt = parseInt(row[2]) || 0;
    const semLabel = (row[6] || '').trim();
    const semCnt = parseInt(row[7]) || 0;

    if (suc) curSuc2 = suc.includes('iña') ? 'Vina' : 'Santiago';
    const id = resolveId(cons);
    if (!id) return;

    if (curSuc2 === 'Santiago') {
      result.consStgoMes[id] = (result.consStgoMes[id] || 0) + cnt;
      if (semLabel === week) result.consStgo[id] = (result.consStgo[id] || 0) + semCnt;
    } else {
      result.consVinaMes[id] = (result.consVinaMes[id] || 0) + cnt;
      if (semLabel === week) result.consVina[id] = (result.consVina[id] || 0) + semCnt;
    }
  });

  return result;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
const sumObj = obj => Object.values(obj).reduce((a, b) => a + b, 0);
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const metaSem = m => Math.round(m / 4);

function topExec(convData, group) {
  let best = null, bestVal = -1;
  Object.entries(group.execs).forEach(([id, e]) => {
    const v = convData[id] || 0;
    if (v > bestVal) { bestVal = v; best = e.nombre; }
  });
  return best ? `${best} (${bestVal})` : '—';
}

// ─── STYLES (CSS-in-JS) ──────────────────────────────────────────────────────
const S = {
  app: {
    background: '#0a0d14',
    minHeight: '100vh',
    fontFamily: "'DM Sans', sans-serif",
    color: '#e2e8f0',
    padding: '16px 20px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  logo: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '3px',
    color: '#3b82f6',
    textTransform: 'uppercase',
    fontFamily: "'DM Mono', monospace",
    marginBottom: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: 500,
    color: '#f1f5f9',
  },
  rightBar: { display: 'flex', alignItems: 'center', gap: 12 },
  weekPill: {
    background: '#111827',
    border: '1px solid #1e293b',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 12,
    color: '#64748b',
    fontFamily: "'DM Mono', monospace",
  },
  weekVal: { color: '#f59e0b', fontWeight: 600 },
  tabs: { display: 'flex', gap: 3 },
  tab: {
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    background: '#111827',
    color: '#475569',
    transition: 'all .15s',
  },
  tabActive: {
    background: '#3b82f6',
    color: '#fff',
  },
  refreshTime: {
    fontSize: 11,
    color: '#334155',
    fontFamily: "'DM Mono', monospace",
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    marginBottom: 16,
  },
  kpi: {
    background: '#0f1520',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '14px 18px',
  },
  kpiLabel: {
    fontSize: 10,
    color: '#475569',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    fontFamily: "'DM Mono', monospace",
    marginBottom: 8,
  },
  kpiVal: {
    fontSize: 26,
    fontWeight: 600,
    color: '#f1f5f9',
    lineHeight: 1,
    marginBottom: 6,
  },
  kpiSub: { fontSize: 12, marginTop: 2 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    marginBottom: 10,
    fontFamily: "'DM Mono', monospace",
  },
  groups: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  group: {
    background: '#0f1520',
    border: '1px solid #1e293b',
    borderRadius: 12,
    overflow: 'hidden',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #1a2235',
  },
  groupLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  groupName: { fontSize: 13, fontWeight: 600, color: '#f1f5f9' },
  groupRight: { display: 'flex', alignItems: 'center', gap: 8 },
  groupTotal: { fontSize: 22, fontWeight: 600, color: '#f1f5f9' },
  progRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px 6px',
    borderBottom: '1px solid #111827',
  },
  progLabel: { fontSize: 11, color: '#475569', width: 90, whiteSpace: 'nowrap' },
  progBg: { flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' },
  progFill: { height: 4, borderRadius: 2, transition: 'width .4s ease' },
  progPct: {
    fontSize: 11, color: '#64748b',
    width: 34, textAlign: 'right',
    fontFamily: "'DM Mono', monospace",
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    fontSize: 10, color: '#334155', fontWeight: 500,
    textAlign: 'left', padding: '6px 16px',
    textTransform: 'uppercase', letterSpacing: '.5px',
    fontFamily: "'DM Mono', monospace",
  },
  thR: { textAlign: 'right' },
  td: {
    fontSize: 13, padding: '8px 16px',
    borderTop: '1px solid #111827', color: '#94a3b8',
  },
  tdR: { textAlign: 'right' },
  execName: { fontWeight: 500, color: '#e2e8f0' },
  badge: {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 7px', borderRadius: 10,
    fontSize: 11, fontWeight: 600, marginLeft: 4,
  },
  varBadge: {
    fontSize: 11, fontWeight: 600,
    padding: '2px 8px', borderRadius: 20,
  },
  loading: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', color: '#334155', fontSize: 14,
    fontFamily: "'DM Mono', monospace", flexDirection: 'column', gap: 12,
  },
  spinner: {
    width: 20, height: 20,
    border: '2px solid #1e293b',
    borderTop: '2px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorBox: {
    background: '#1a0a0a', border: '1px solid #450a0a',
    borderRadius: 8, padding: '12px 16px',
    color: '#ef4444', fontSize: 12, marginBottom: 16,
    fontFamily: "'DM Mono', monospace",
  },
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function VarBadge({ val, prev }) {
  const p = pct(val, prev);
  if (p === null) return null;
  const up = p >= 0;
  return (
    <span style={{
      ...S.varBadge,
      background: up ? '#042f1e' : '#2d0a0a',
      color: up ? '#10b981' : '#ef4444',
    }}>
      {up ? '↑' : '↓'} {up ? '+' : ''}{p}%
    </span>
  );
}

function InlineBadge({ val, prev }) {
  if (prev === undefined || prev === null || prev === 0) {
    return <span style={{ ...S.badge, background: '#0c1a2e', color: '#60a5fa' }}>nuevo</span>;
  }
  const p = pct(val, prev);
  if (p === null) return null;
  const up = p >= 0;
  return (
    <span style={{
      ...S.badge,
      background: up ? '#042f1e' : '#2d0a0a',
      color: up ? '#10b981' : '#ef4444',
    }}>
      {up ? '+' : ''}{p}%
    </span>
  );
}

function ProgressBar({ val, meta, color }) {
  const w = Math.min(100, meta > 0 ? Math.round(val / meta * 100) : 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 70 }}>
      <div style={{ ...S.progBg, width: 50 }}>
        <div style={{ ...S.progFill, width: `${w}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, color: '#475569', fontFamily: "'DM Mono', monospace" }}>{w}%</span>
    </div>
  );
}

function GroupCard({ groupKey, group, convCur, convPrev, ventasData, tab }) {
  const isSem = tab !== 'mes';
  const vData = isSem ? ventasData[groupKey] : ventasData[groupKey + 'Mes'];
  const metaTotal = isSem ? metaSem(group.metaMensual) : group.metaMensual;
  const totalActual = sumObj(vData || {});

  // prev total (semana anterior no disponible directamente, usamos mensual como fallback)
  const prevTotal = null;

  const pctTotal = metaTotal > 0 ? Math.min(100, Math.round(totalActual / metaTotal * 100)) : 0;

  const week = getCurrentWeek();

  return (
    <div style={S.group}>
      <div style={S.groupHeader}>
        <div style={S.groupLeft}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: group.color, flexShrink: 0,
          }} />
          <span style={S.groupName}>{group.label}</span>
          {isSem && (
            <span style={{
              fontSize: 10, color: '#334155',
              fontFamily: "'DM Mono', monospace",
            }}>{week}</span>
          )}
        </div>
        <div style={S.groupRight}>
          <span style={S.groupTotal}>{totalActual}</span>
          {prevTotal !== null && <VarBadge val={totalActual} prev={prevTotal} />}
        </div>
      </div>

      <div style={S.progRow}>
        <span style={S.progLabel}>Meta: {metaTotal}</span>
        <div style={S.progBg}>
          <div style={{ ...S.progFill, width: `${pctTotal}%`, background: group.color }} />
        </div>
        <span style={S.progPct}>{pctTotal}%</span>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Ejecutivo</th>
            <th style={{ ...S.th, ...S.thR }}>Conv.</th>
            <th style={{ ...S.th, ...S.thR }}>{group.tipo}</th>
            <th style={{ ...S.th, ...S.thR }}>Meta</th>
            <th style={{ ...S.th, ...S.thR }}>Avance</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(group.execs).map(([id, info]) => {
            const real = (vData || {})[id] || 0;
            const execMeta = isSem ? metaSem(info.meta) : info.meta;
            const conv = convCur[id] || 0;
            const prevConv = convPrev[id] || 0;
            return (
              <tr key={id}>
                <td style={S.td}>
                  <span style={S.execName}>{info.nombre}</span>
                </td>
                <td style={{ ...S.td, ...S.tdR }}>
                  {conv}
                  <InlineBadge val={conv} prev={prevConv > 0 ? prevConv : null} />
                </td>
                <td style={{ ...S.td, ...S.tdR, color: '#f1f5f9', fontWeight: 500 }}>{real}</td>
                <td style={{ ...S.td, ...S.tdR }}>{execMeta}</td>
                <td style={{ ...S.td, ...S.tdR }}>
                  <ProgressBar val={real} meta={execMeta} color={group.color} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ height: 8 }} />
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('hoy');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [convRows, ventasRows, consRows] = await Promise.all([
        fetchSheet('Dashboard Data - Mensajes!A:D'),
        fetchSheet('Ventas!A:H'),
        fetchSheet('Consignaciones!A:H'),
      ]);

      const convByDate = parseConvData(convRows);
      const vcons = parseVentasConsignas(ventasRows, consRows);

      setData({ convByDate, vcons });
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  const week = getCurrentWeek();

  const convCur  = data ? getConvForPeriod(data.convByDate, tab) : {};
  const convPrev = data ? getConvForPeriod(data.convByDate, tab === 'hoy' ? 'ayer' : 'mes') : {};

  const totCur   = sumObj(convCur);
  const totPrev  = sumObj(convPrev);
  const activeCur  = Object.keys(convCur).filter(k => k !== '0' && convCur[k] > 0).length;
  const activePrev = Object.keys(convPrev).filter(k => k !== '0' && convPrev[k] > 0).length;

  // Top Vendedor y Top Consignador (por conversaciones en el período)
  function topInGroup(execs) {
    let best = null, bestV = -1;
    Object.entries(execs).forEach(([id, e]) => {
      const v = convCur[id] || 0;
      if (v > bestV) { bestV = v; best = e.nombre; }
    });
    return best ? `${best.split(' ')[0]} — ${bestV} conv.` : '—';
  }

  const allVentasExecs = { ...GROUPS.ventasStgo.execs, ...GROUPS.ventasVina.execs };
  const allConsExecs   = { ...GROUPS.consStgo.execs, ...GROUPS.consVina.execs };
  const topVendedor    = topInGroup(allVentasExecs);
  const topConsignador = topInGroup(allConsExecs);

  const now = lastRefresh;
  const timeStr = now
    ? `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`
    : '–';

  if (loading) {
    return (
      <div style={S.app}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={S.loading}>
          <div style={S.spinner} />
          <span>Cargando datos…</span>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* TOP BAR */}
      <div style={S.topBar}>
        <div>
          <div style={S.logo}>Auto360</div>
          <div style={S.title}>Supervisión Comercial</div>
        </div>
        <div style={S.rightBar}>
          <div style={S.weekPill}>
            Semana <span style={S.weekVal}>{week}</span>
          </div>
          <div style={S.tabs}>
            {['hoy','ayer','semana','mes'].map(t => (
              <button
                key={t}
                style={t === tab ? { ...S.tab, ...S.tabActive } : S.tab}
                onClick={() => setTab(t)}
              >
                {t === 'hoy' ? 'Hoy' : t === 'ayer' ? 'Ayer' : t === 'semana' ? 'Esta semana' : 'Este mes'}
              </button>
            ))}
          </div>
          <span style={S.refreshTime}>↻ {timeStr}</span>
        </div>
      </div>

      {/* ERROR */}
      {error && <div style={S.errorBox}>⚠ Error al cargar: {error}</div>}

      {/* KPIs */}
      <div style={S.kpiRow}>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Total conversaciones</div>
          <div style={S.kpiVal}>{totCur}</div>
          <div style={{ ...S.kpiSub, color: pct(totCur, totPrev) >= 0 ? '#10b981' : '#ef4444' }}>
            {pct(totCur, totPrev) !== null
              ? `${pct(totCur, totPrev) >= 0 ? '↑ +' : '↓ '}${Math.abs(pct(totCur, totPrev))}% vs período anterior`
              : 'Sin datos previos'}
          </div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top vendedor</div>
          <div style={{ ...S.kpiVal, fontSize: 16, paddingTop: 5 }}>{topVendedor}</div>
          <div style={{ ...S.kpiSub, color: '#3b82f6' }}>por conversaciones</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top consignador</div>
          <div style={{ ...S.kpiVal, fontSize: 16, paddingTop: 5 }}>{topConsignador}</div>
          <div style={{ ...S.kpiSub, color: '#10b981' }}>por conversaciones</div>
        </div>
      </div>

      {/* GROUPS */}
      <div style={S.sectionLabel}>Equipos comerciales</div>
      {data && (
        <div style={S.groups}>
          {Object.entries(GROUPS).map(([key, group]) => (
            <GroupCard
              key={key}
              groupKey={key}
              group={group}
              convCur={convCur}
              convPrev={convPrev}
              ventasData={data.vcons}
              tab={tab}
            />
          ))}
        </div>
      )}
    </div>
  );
}
