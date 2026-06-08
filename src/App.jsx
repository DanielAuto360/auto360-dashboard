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

// Rango de días para la semana actual (W1=1-7, W2=8-14, etc.) del mes en curso
function currentWeekRange() {
  const weekNum = Math.ceil(new Date().getDate() / 7);
  const start = (weekNum - 1) * 7 + 1;
  const end   = weekNum * 7;
  return { start, end };
}
// Rango del mes en curso
function currentMonthRange() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function getConvForPeriod(byDate, tab) {
  const keys = Object.keys(byDate);
  if (tab === 'hoy')  return byDate[todayKey()]     || {};
  if (tab === 'ayer') return byDate[yesterdayKey()] || {};

  if (tab === 'semana') {
    const { start, end } = currentWeekRange();
    const { month, year } = currentMonthRange();
    const merged = {};
    keys.forEach(k => {
      const [d, m, y] = k.split('/').map(Number);
      if (y === year && m === month && d >= start && d <= end) {
        Object.entries(byDate[k] || {}).forEach(([id, v]) => {
          merged[id] = (merged[id] || 0) + v;
        });
      }
    });
    return merged;
  }

  if (tab === 'mes') {
    const { month, year } = currentMonthRange();
    const merged = {};
    keys.forEach(k => {
      const [d, m, y] = k.split('/').map(Number);
      if (y === year && m === month) {
        Object.entries(byDate[k] || {}).forEach(([id, v]) => {
          merged[id] = (merged[id] || 0) + v;
        });
      }
    });
    return merged;
  }

  return {};
}

const sumObj = obj => Object.values(obj || {}).reduce((a, b) => a + b, 0);

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

  // ── Ventas: leer tabla izquierda (ejecutivos+mes) y tabla derecha (semanas) por separado
  // Tabla izquierda: col 0=SUCURSAL, 1=Vendedor, 2=COUNTA PPU
  // Tabla derecha:   col 5=Semana label (W1,W2..), 6=COUNTA PPU semana
  // La tabla de semanas tiene sus propias filas independientes de la de ejecutivos

  // 1) Acumular totales mensuales por ejecutivo (tabla izquierda)
  let curSuc = 'Santiago';
  ventasRows.forEach(row => {
    const suc  = (row[0] || '').trim();
    const vend = (row[1] || '').trim();
    const cnt  = parseInt(row[2]) || 0;
    if (suc && !suc.toLowerCase().includes('total') && !suc.toLowerCase().includes('suma')) {
      curSuc = suc.includes('iña') ? 'Vina' : 'Santiago';
    }
    const id = resolveId(vend);
    if (!id || !cnt) return;
    if (curSuc === 'Santiago') result.ventasStgoMes[id] = (result.ventasStgoMes[id] || 0) + cnt;
    else                       result.ventasVinaMes[id] = (result.ventasVinaMes[id] || 0) + cnt;
  });

  // 2) Leer tabla de semanas (tabla derecha de Ventas)
  // Busca filas donde col5 o col6 tenga el label de semana y un número
  // Estructura: fila header "Venta por Semana", luego "Semana, COUNTA", luego "W1, 9" etc.
  // Como la tabla semanal es GLOBAL (total Santiago+Viña juntos en W1),
  // repartimos proporcionalmente según los pesos mensuales por sucursal
  let ventasSemTotal = 0;
  ventasRows.forEach(row => {
    const label = (row[5] || row[4] || '').trim();
    const val   = parseInt(row[6] || row[5] || '') || 0;
    if (label === week && val > 0) ventasSemTotal += val;
  });

  // Si no encontró en col5/6 busca en col6/7
  if (ventasSemTotal === 0) {
    ventasRows.forEach(row => {
      const label = (row[6] || '').trim();
      const val   = parseInt(row[7]) || 0;
      if (label === week && val > 0) ventasSemTotal += val;
    });
  }

  // Distribuir el total semanal entre ejecutivos proporcional al mes
  const mesStgoTotal = sumObj(result.ventasStgoMes);
  const mesVinaTotal = sumObj(result.ventasVinaMes);
  const mesTotalVentas = mesStgoTotal + mesVinaTotal;

  if (ventasSemTotal > 0 && mesTotalVentas > 0) {
    Object.entries(result.ventasStgoMes).forEach(([id, v]) => {
      result.ventasStgo[id] = Math.round(ventasSemTotal * (v / mesTotalVentas));
    });
    Object.entries(result.ventasVinaMes).forEach(([id, v]) => {
      result.ventasVina[id] = Math.round(ventasSemTotal * (v / mesTotalVentas));
    });
  } else {
    // Fallback: usar mensuales directamente
    result.ventasStgo  = { ...result.ventasStgoMes };
    result.ventasVina  = { ...result.ventasVinaMes };
  }

  // ── Consignaciones: misma lógica
  let curSuc2 = 'Santiago';
  consRows.forEach(row => {
    const suc  = (row[0] || '').trim();
    const cons = (row[1] || '').trim();
    const cnt  = parseInt(row[2]) || 0;
    if (suc && !suc.toLowerCase().includes('total') && !suc.toLowerCase().includes('suma')) {
      curSuc2 = suc.includes('iña') ? 'Vina' : 'Santiago';
    }
    const id = resolveId(cons);
    if (!id || !cnt) return;
    if (curSuc2 === 'Santiago') result.consStgoMes[id] = (result.consStgoMes[id] || 0) + cnt;
    else                        result.consVinaMes[id] = (result.consVinaMes[id] || 0) + cnt;
  });

  // Leer total semanal de consignaciones
  let consSemTotal = 0;
  consRows.forEach(row => {
    // Busca en distintas columnas posibles
    for (let c = 4; c <= 8; c++) {
      const label = (row[c] || '').trim();
      const val   = parseInt(row[c+1]) || 0;
      if (label === week && val > 0) { consSemTotal += val; break; }
    }
  });

  const mesConsStgoTotal = sumObj(result.consStgoMes);
  const mesConsVinaTotal = sumObj(result.consVinaMes);
  const mesTotalCons = mesConsStgoTotal + mesConsVinaTotal;

  if (consSemTotal > 0 && mesTotalCons > 0) {
    Object.entries(result.consStgoMes).forEach(([id, v]) => {
      result.consStgo[id] = Math.round(consSemTotal * (v / mesTotalCons));
    });
    Object.entries(result.consVinaMes).forEach(([id, v]) => {
      result.consVina[id] = Math.round(consSemTotal * (v / mesTotalCons));
    });
  } else {
    result.consStgo = { ...result.consStgoMes };
    result.consVina = { ...result.consVinaMes };
  }

  return result;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
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

// ─── STYLES — optimizado para pantalla kiosk ─────────────────────────────────
const S = {
  app: {
    background: '#070a10',
    minHeight: '100vh',
    fontFamily: "'DM Sans', sans-serif",
    color: '#e2e8f0',
    padding: '14px 18px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  logo: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '4px',
    color: '#3b82f6',
    textTransform: 'uppercase',
    fontFamily: "'DM Mono', monospace",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: '#ffffff',
    letterSpacing: '-0.3px',
  },
  rightBar: { display: 'flex', alignItems: 'center', gap: 12 },
  weekPill: {
    background: '#111827',
    border: '1px solid #2d3748',
    borderRadius: 20,
    padding: '6px 16px',
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: "'DM Mono', monospace",
  },
  weekVal: { color: '#fbbf24', fontWeight: 700 },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '7px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    background: '#111827',
    color: '#64748b',
    transition: 'all .15s',
  },
  tabActive: {
    background: '#2563eb',
    color: '#fff',
    fontWeight: 600,
  },
  refreshTime: {
    fontSize: 12,
    color: '#374151',
    fontFamily: "'DM Mono', monospace",
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    marginBottom: 14,
  },
  kpi: {
    background: '#0d1117',
    border: '1px solid #1e2d3d',
    borderRadius: 12,
    padding: '16px 20px',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#4b5563',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    fontFamily: "'DM Mono', monospace",
    marginBottom: 10,
  },
  kpiVal: {
    fontSize: 40,
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1,
    marginBottom: 8,
  },
  kpiSub: { fontSize: 13, marginTop: 2 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    marginBottom: 10,
    fontFamily: "'DM Mono', monospace",
  },
  groups: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  group: {
    background: '#0d1117',
    border: '1px solid #1e2d3d',
    borderRadius: 12,
    overflow: 'hidden',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: '1px solid #131c29',
  },
  groupLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  groupName: { fontSize: 15, fontWeight: 700, color: '#ffffff' },
  groupRight: { display: 'flex', alignItems: 'center', gap: 10 },
  groupTotal: { fontSize: 30, fontWeight: 700, color: '#ffffff' },
  progRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 18px 8px',
    borderBottom: '1px solid #0d1117',
  },
  progLabel: { fontSize: 12, color: '#4b5563', width: 95, whiteSpace: 'nowrap' },
  progBg: { flex: 1, height: 6, background: '#1a2535', borderRadius: 3, overflow: 'hidden' },
  progFill: { height: 6, borderRadius: 3, transition: 'width .4s ease' },
  progPct: {
    fontSize: 12, color: '#6b7280',
    width: 36, textAlign: 'right',
    fontFamily: "'DM Mono', monospace",
    fontWeight: 600,
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    fontSize: 11, color: '#374151', fontWeight: 600,
    textAlign: 'left', padding: '8px 18px',
    textTransform: 'uppercase', letterSpacing: '.8px',
    fontFamily: "'DM Mono', monospace",
    borderBottom: '1px solid #131c29',
  },
  thR: { textAlign: 'right' },
  td: {
    fontSize: 14, padding: '10px 18px',
    borderTop: '1px solid #0f1620', color: '#9ca3af',
  },
  tdR: { textAlign: 'right' },
  execName: { fontWeight: 600, color: '#e5e7eb', fontSize: 14 },
  badge: {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 700, marginLeft: 5,
  },
  varBadge: {
    fontSize: 12, fontWeight: 700,
    padding: '3px 10px', borderRadius: 20,
  },
  loading: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', color: '#374151', fontSize: 14,
    fontFamily: "'DM Mono', monospace", flexDirection: 'column', gap: 12,
  },
  spinner: {
    width: 24, height: 24,
    border: '2px solid #1e293b',
    borderTop: '2px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorBox: {
    background: '#1a0a0a', border: '1px solid #450a0a',
    borderRadius: 8, padding: '12px 16px',
    color: '#ef4444', fontSize: 13, marginBottom: 14,
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
