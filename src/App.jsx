import React, { useState, useEffect, useCallback } from 'react';

const SHEET_ID = '1yopN8O-uwsCkYhevSmGnGaLPTHGcOjyHhRDtn3ranTo';
const API_KEY  = 'AIzaSyDepLhTVDuWyogq7Zj9lLFUG2K9-0B_gHU';
const REFRESH_MS = 5 * 60 * 1000;

// ─── UTILS ───────────────────────────────────────────────────────────────────
const sumObj = obj => Object.values(obj || {}).reduce((a, b) => a + b, 0);
const pct    = (a, b) => (b ? Math.round((a - b) / b * 100) : null);

function getCurrentWeek() {
  return 'W' + Math.ceil(new Date().getDate() / 7);
}
function dateKey(d) {
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}
function todayKey()     { return dateKey(new Date()); }
function yesterdayKey() { const d = new Date(); d.setDate(d.getDate()-1); return dateKey(d); }
function normDate(raw) {
  if (!raw) return '';
  const p = raw.trim().split('/');
  if (p.length !== 3) return raw.trim();
  return `${p[0].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[2]}`;
}
function currentMonthYear() {
  const n = new Date();
  return { month: n.getMonth()+1, year: n.getFullYear() };
}
function currentWeekRange() {
  const w = Math.ceil(new Date().getDate() / 7);
  return { start: (w-1)*7+1, end: w*7 };
}

// ─── SHEETS FETCH ────────────────────────────────────────────────────────────
async function fetchSheet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${range}`);
  return (await res.json()).values || [];
}

// ─── NAME NORMALIZER ─────────────────────────────────────────────────────────
// Convierte "Pedro P." → "pedro p." para comparar sin case ni espacios extra
function normName(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Construye un mapa nombre-normalizado → ID desde la hoja Ejecutivos
function buildNameMap(execRows) {
  const map = {}; // normName → { id, nombre }
  execRows.slice(1).forEach(row => {
    const id     = (row[0] || '').trim();
    const nombre = (row[1] || '').trim();
    if (!id || !nombre) return;
    // nombre completo
    map[normName(nombre)] = { id, nombre };
    // alias "Nombre A."
    const parts = nombre.split(' ');
    if (parts.length >= 2) {
      const alias = `${parts[0]} ${parts[1][0]}.`;
      map[normName(alias)] = { id, nombre };
      // sin punto
      map[normName(`${parts[0]} ${parts[1][0]}`)] = { id, nombre };
    }
  });
  return map;
}

function resolveId(rawName, nameMap) {
  if (!rawName) return null;
  const n = normName(rawName);
  if (nameMap[n]) return nameMap[n].id;
  // fuzzy: busca por primer token
  const first = n.split(' ')[0];
  const found = Object.keys(nameMap).find(k => k.startsWith(first + ' '));
  return found ? nameMap[found].id : null;
}

// ─── CONFIG PARSER ───────────────────────────────────────────────────────────
// Lee la hoja Config y extrae metas por nombre de ejecutivo
// Devuelve:
// {
//   ventasStgo:  { id: { nombre, metaMensual, metaSemanal } },
//   ventasVina:  { ... },
//   consStgo:    { ... },
//   consVina:    { ... },
//   convVentasStgo:  { id: { metaMensual, metaSemanal } },
//   convVentasVina:  { ... },
//   convConsStgo:    { ... },
//   convConsVina:    { ... },
// }
function parseConfig(configRows, nameMap) {
  const result = {
    ventasStgo: {}, ventasVina: {},
    consStgo: {}, consVina: {},
    convVentasStgo: {}, convVentasVina: {},
    convConsStgo: {}, convConsVina: {},
  };

  // Detecta en qué sección estamos según encabezados que aparecen en col A o F
  // Secciones izquierda (col A-C): Metas Ventas, Metas Conversaciones Ventas
  // Secciones derecha (col F-H):   Metas Consignas, Metas Conversaciones Consignas
  let leftSection  = null; // 'ventasMes' | 'convVentas'
  let rightSection = null; // 'consMes'   | 'convCons'
  let leftSuc  = 'Santiago';
  let rightSuc = 'Santiago';

  configRows.forEach(row => {
    const a = normName(row[0] || '');
    const b = (row[1] || '').toString().trim();
    const c = (row[2] || '').toString().trim();
    const f = normName(row[5] || '');
    const g = (row[6] || '').toString().trim();
    const h = (row[7] || '').toString().trim();

    // Detectar encabezados de sección izquierda
    if (a.includes('metas ventas') && !a.includes('conversacion')) leftSection = 'ventasMes';
    if (a.includes('conversacion') && a.includes('ventas'))         leftSection = 'convVentas';

    // Detectar encabezados de sección derecha
    if (f.includes('metas consign') && !f.includes('conversacion')) rightSection = 'consMes';
    if (f.includes('conversacion') && f.includes('consign'))         rightSection = 'convCons';

    // Detectar sucursal por totales
    if (a.includes('total santiago')) leftSuc = 'Santiago';
    if (a.includes('total vi'))       leftSuc = 'Vina';
    if (f.includes('total santiago')) rightSuc = 'Santiago';
    if (f.includes('total vi'))       rightSuc = 'Vina';

    // Procesar fila izquierda (col A = nombre ejecutivo)
    if (leftSection && row[0]) {
      const id = resolveId(row[0], nameMap);
      const mes = parseInt(b) || 0;
      const sem = parseInt(c) || 0;
      if (id && mes > 0) {
        const nombre = nameMap[normName(row[0])]?.nombre || row[0].trim();
        if (leftSection === 'ventasMes') {
          const bucket = leftSuc === 'Santiago' ? 'ventasStgo' : 'ventasVina';
          result[bucket][id] = { nombre, metaMensual: mes, metaSemanal: sem };
        } else if (leftSection === 'convVentas') {
          const bucket = leftSuc === 'Santiago' ? 'convVentasStgo' : 'convVentasVina';
          result[bucket][id] = { metaMensual: mes, metaSemanal: sem };
        }
      }
    }

    // Procesar fila derecha (col F = nombre ejecutivo)
    if (rightSection && row[5]) {
      const id = resolveId(row[5], nameMap);
      const mes = parseInt(g) || 0;
      const sem = parseInt(h) || 0;
      if (id && mes > 0) {
        const nombre = nameMap[normName(row[5])]?.nombre || row[5].trim();
        if (rightSection === 'consMes') {
          const bucket = rightSuc === 'Santiago' ? 'consStgo' : 'consVina';
          result[bucket][id] = { nombre, metaMensual: mes, metaSemanal: sem };
        } else if (rightSection === 'convCons') {
          const bucket = rightSuc === 'Santiago' ? 'convConsStgo' : 'convConsVina';
          result[bucket][id] = { metaMensual: mes, metaSemanal: sem };
        }
      }
    }
  });

  return result;
}

// ─── CONVERSACIONES PARSER ───────────────────────────────────────────────────
function parseConv(rows) {
  const byDate = {};
  rows.slice(1).forEach(row => {
    const fecha  = normDate((row[0] || '').trim());
    const execId = (row[1] || '').trim();
    const leads  = parseInt(row[2]) || 0;
    if (!fecha || !execId) return;
    if (!byDate[fecha]) byDate[fecha] = {};
    byDate[fecha][execId] = (byDate[fecha][execId] || 0) + leads;
  });
  return byDate;
}

function getConvForPeriod(byDate, tab) {
  const keys = Object.keys(byDate);
  if (tab === 'hoy')  return { ...byDate[todayKey()]     || {} };
  if (tab === 'ayer') return { ...byDate[yesterdayKey()] || {} };

  const { month, year } = currentMonthYear();

  if (tab === 'semana') {
    const { start, end } = currentWeekRange();
    const merged = {};
    keys.forEach(k => {
      const [d,m,y] = k.split('/').map(Number);
      if (y === year && m === month && d >= start && d <= end) {
        Object.entries(byDate[k]).forEach(([id,v]) => {
          merged[id] = (merged[id] || 0) + v;
        });
      }
    });
    return merged;
  }

  // mes
  const merged = {};
  keys.forEach(k => {
    const [,m,y] = k.split('/').map(Number);
    if (y === year && m === month) {
      Object.entries(byDate[k]).forEach(([id,v]) => {
        merged[id] = (merged[id] || 0) + v;
      });
    }
  });
  return merged;
}

// ─── VENTAS / CONSIGNAS PARSER ───────────────────────────────────────────────
// Lee hoja Ventas o Consignaciones
// Devuelve { semana: { id: count }, mes: { id: count } }
function parseResultados(rows, nameMap, week) {
  const semana = {};
  const mes    = {};

  // Tabla izquierda (col A=SUCURSAL, B=Vendedor/Consignador, C=COUNTA PPU mensual)
  // Tabla derecha  (col F=Semana label, G=COUNTA)
  // Las semanas en la tabla derecha son totales globales, las distribuimos por ejecutivo

  // 1) Acumular mensual por ejecutivo
  rows.forEach(row => {
    const nombre = (row[1] || '').trim();
    const cnt    = parseInt(row[2]) || 0;
    const id     = resolveId(nombre, nameMap);
    if (!id || !cnt) return;
    mes[id] = (mes[id] || 0) + cnt;
  });

  // 2) Encontrar total de la semana actual en tabla derecha
  // Busca en columnas 4-8 el label que coincida con la semana actual
  let semTotal = 0;
  rows.forEach(row => {
    for (let c = 4; c <= 7; c++) {
      const label = (row[c] || '').trim();
      const val   = parseInt(row[c+1]) || 0;
      if (label === week && val > 0) {
        semTotal += val;
        break;
      }
    }
  });

  // 3) Distribuir total semanal proporcionalmente según peso mensual
  const mesTotal = sumObj(mes);
  if (semTotal > 0 && mesTotal > 0) {
    Object.entries(mes).forEach(([id, v]) => {
      semana[id] = Math.round(semTotal * (v / mesTotal));
    });
  } else {
    Object.assign(semana, mes);
  }

  return { semana, mes };
}

// ─── TOP EXEC ────────────────────────────────────────────────────────────────
function getTop(convMap, execIds) {
  let best = null, bestV = -1;
  execIds.forEach(id => {
    const v = convMap[id] || 0;
    if (v > bestV) { bestV = v; best = id; }
  });
  return { id: best, val: bestV };
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState('hoy');
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [execRows, convRows, ventasRows, consRows, configRows] = await Promise.all([
        fetchSheet('Ejecutivos!A:B'),
        fetchSheet('Dashboard Data - Mensajes!A:C'),
        fetchSheet('Ventas!A:H'),
        fetchSheet('Consignaciones!A:H'),
        fetchSheet('Config!A:H'),
      ]);

      const nameMap  = buildNameMap(execRows);
      const convData = parseConv(convRows);
      const week     = getCurrentWeek();
      const config   = parseConfig(configRows, nameMap);
      const ventas   = parseResultados(ventasRows, nameMap, week);
      const cons     = parseResultados(consRows,   nameMap, week);

      setData({ nameMap, convData, config, ventas, cons });
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

  if (loading) return <LoadingScreen />;

  const week = getCurrentWeek();
  const isSem = tab === 'semana';
  const isMes = tab === 'mes';

  const convCur  = data ? getConvForPeriod(data.convData, tab)    : {};
  const convPrev = data ? getConvForPeriod(data.convData, tab === 'hoy' ? 'ayer' : 'mes') : {};
  const totCur   = sumObj(convCur);
  const totPrev  = sumObj(convPrev);
  const pctTot   = pct(totCur, totPrev);

  // Top vendedor y consignador
  const ventasIds = data ? [
    ...Object.keys(data.config.ventasStgo),
    ...Object.keys(data.config.ventasVina),
  ] : [];
  const consIds = data ? [
    ...Object.keys(data.config.consStgo),
    ...Object.keys(data.config.consVina),
  ] : [];
  const topVend = data ? getTop(convCur, ventasIds) : null;
  const topCons = data ? getTop(convCur, consIds)   : null;
  const topVendNombre = topVend?.id ? (data.nameMap[normName(Object.values(data.nameMap).find(x=>x.id===topVend.id)?.nombre||'')]?.nombre || '—') : '—';
  const topConsNombre = topCons?.id ? (data.nameMap[normName(Object.values(data.nameMap).find(x=>x.id===topCons.id)?.nombre||'')]?.nombre || '—') : '—';

  // Helper para obtener nombre desde ID
  function nombreById(id) {
    const entry = Object.values(data.nameMap).find(x => x.id === id);
    return entry?.nombre || id;
  }

  // Datos de ventas/consignas según tab
  const ventasData = (isMes || isSem) ? (isMes ? data?.ventas.mes : data?.ventas.semana) : data?.ventas.semana;
  const consData   = (isMes || isSem) ? (isMes ? data?.cons.mes   : data?.cons.semana)   : data?.cons.semana;

  const now = lastRefresh;
  const timeStr = now ? `${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}` : '–';

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
          <div style={S.weekPill}>Semana <span style={S.weekVal}>{week}</span></div>
          <div style={S.tabs}>
            {[['hoy','Hoy'],['ayer','Ayer'],['semana','Esta semana'],['mes','Este mes']].map(([k,l]) => (
              <button key={k} style={k===tab?{...S.tab,...S.tabActive}:S.tab} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>
          <span style={S.refreshTime}>↻ {timeStr}</span>
        </div>
      </div>

      {error && <div style={S.errorBox}>⚠ {error}</div>}

      {/* KPIs */}
      <div style={S.kpiRow}>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Total conversaciones</div>
          <div style={S.kpiVal}>{totCur}</div>
          {pctTot !== null && (
            <div style={{...S.kpiSub, color: pctTot>=0?'#10b981':'#ef4444'}}>
              {pctTot>=0?'↑ +':'↓ '}{Math.abs(pctTot)}% vs período anterior
            </div>
          )}
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top vendedor</div>
          <div style={{...S.kpiVal, fontSize:17, paddingTop:5}}>
            {topVend?.val > 0 ? `${topVendNombre.split(' ')[0]} — ${topVend.val} conv.` : '—'}
          </div>
          <div style={{...S.kpiSub, color:'#3b82f6'}}>por conversaciones</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top consignador</div>
          <div style={{...S.kpiVal, fontSize:17, paddingTop:5}}>
            {topCons?.val > 0 ? `${topConsNombre.split(' ')[0]} — ${topCons.val} conv.` : '—'}
          </div>
          <div style={{...S.kpiSub, color:'#10b981'}}>por conversaciones</div>
        </div>
      </div>

      {data && <>
        {/* SECCIÓN 1: CONVERSACIONES */}
        <div style={S.sectionBlock}>
          <div style={S.sectionTitle}>Conversaciones</div>
          <div style={S.sectionSub}>avance vs meta por ejecutivo — {isMes?'este mes': isSem?'esta semana':'hoy'}</div>
          <div style={S.twoCol}>
            <GroupCard
              label="Ventas Santiago" color="#3b82f6"
              execs={data.config.ventasStgo}
              convMetas={data.config.convVentasStgo}
              convCur={convCur} convPrev={convPrev}
              tab={tab} tipo="conv"
              nombreById={nombreById}
            />
            <GroupCard
              label="Ventas Viña" color="#8b5cf6"
              execs={data.config.ventasVina}
              convMetas={data.config.convVentasVina}
              convCur={convCur} convPrev={convPrev}
              tab={tab} tipo="conv"
              nombreById={nombreById}
            />
            <GroupCard
              label="Consignas Santiago" color="#10b981"
              execs={data.config.consStgo}
              convMetas={data.config.convConsStgo}
              convCur={convCur} convPrev={convPrev}
              tab={tab} tipo="conv"
              nombreById={nombreById}
            />
            <GroupCard
              label="Consignas Viña" color="#f59e0b"
              execs={data.config.consVina}
              convMetas={data.config.convConsVina}
              convCur={convCur} convPrev={convPrev}
              tab={tab} tipo="conv"
              nombreById={nombreById}
            />
          </div>
        </div>

        {/* SECCIÓN 2: RESULTADOS */}
        <div style={{...S.sectionBlock, marginBottom:0, borderColor:'#1e3a5f'}}>
          <div style={S.sectionTitle}>Resultados reales</div>
          <div style={S.sectionSub}>ventas y consignaciones vs meta — {isMes?'este mes':'esta semana'}</div>
          <div style={S.twoCol}>
            <GroupCard
              label="Ventas Santiago" color="#3b82f6"
              execs={data.config.ventasStgo}
              convMetas={data.config.convVentasStgo}
              resultData={ventasData}
              tab={tab} tipo="result" colLabel="Ventas"
              nombreById={nombreById}
            />
            <GroupCard
              label="Ventas Viña" color="#8b5cf6"
              execs={data.config.ventasVina}
              convMetas={data.config.convVentasVina}
              resultData={ventasData}
              tab={tab} tipo="result" colLabel="Ventas"
              nombreById={nombreById}
            />
            <GroupCard
              label="Consignas Santiago" color="#10b981"
              execs={data.config.consStgo}
              convMetas={data.config.convConsStgo}
              resultData={consData}
              tab={tab} tipo="result" colLabel="Consignas"
              nombreById={nombreById}
            />
            <GroupCard
              label="Consignas Viña" color="#f59e0b"
              execs={data.config.consVina}
              convMetas={data.config.convConsVina}
              resultData={consData}
              tab={tab} tipo="result" colLabel="Consignas"
              nombreById={nombreById}
            />
          </div>
        </div>
      </>}
    </div>
  );
}

// ─── GROUP CARD ───────────────────────────────────────────────────────────────
function GroupCard({ label, color, execs, convMetas, convCur, convPrev, resultData, tab, tipo, colLabel, nombreById }) {
  const isMes = tab === 'mes';
  const execIds = Object.keys(execs);

  if (tipo === 'conv') {
    const totalMeta = execIds.reduce((a, id) => {
      const m = convMetas?.[id];
      return a + (isMes ? (m?.metaMensual||0) : (m?.metaSemanal||0));
    }, 0);
    const totalActual = execIds.reduce((a, id) => a + (convCur[id]||0), 0);
    const pctTotal = totalMeta > 0 ? Math.min(100, Math.round(totalActual/totalMeta*100)) : 0;

    return (
      <div style={S.card}>
        <div style={S.cardHdr}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
            <span style={S.cardTitle}>{label}</span>
          </div>
          <span style={S.cardMeta}>meta {totalMeta} conv/{isMes?'mes':'sem'}</span>
        </div>
        {execIds.length === 0 && (
          <div style={S.emptyRow}>Sin ejecutivos configurados</div>
        )}
        {execIds.map(id => {
          const meta   = convMetas?.[id];
          const metaV  = isMes ? (meta?.metaMensual||0) : (meta?.metaSemanal||0);
          const actual = convCur[id] || 0;
          const prev   = convPrev[id] || 0;
          const p      = metaV > 0 ? Math.min(100, Math.round(actual/metaV*100)) : 0;
          const nombre = execs[id]?.nombre || nombreById(id);
          return (
            <div key={id} style={S.raceRow}>
              <div style={S.raceTop}>
                <span style={S.raceName}>{nombre}</span>
                <span style={S.raceNums}>{actual} / {metaV}</span>
              </div>
              <div style={S.raceTrack}>
                <div style={{...S.raceFill, width:`${p}%`, background:color}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{...S.racePct, color: p>=100?'#10b981':undefined}}>{p}%{p>=100?' ✓':''}</span>
                {prev > 0 && <PctBadge val={actual} prev={prev}/>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // tipo === 'result'
  const totalMeta = execIds.reduce((a, id) => {
    return a + (isMes ? (execs[id]?.metaMensual||0) : (execs[id]?.metaSemanal||0));
  }, 0);
  const totalActual = execIds.reduce((a, id) => a + ((resultData||{})[id]||0), 0);
  const pctTotal = totalMeta > 0 ? Math.min(100, Math.round(totalActual/totalMeta*100)) : 0;

  return (
    <div style={S.card}>
      <div style={S.cardHdr}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
          <span style={S.cardTitle}>{label}</span>
        </div>
        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
          <span style={{...S.cardTitle,fontSize:20}}>{totalActual}</span>
          <span style={S.cardMeta}>/ meta {totalMeta}</span>
        </div>
      </div>
      {/* Barra total del grupo */}
      <div style={{padding:'8px 14px 4px',borderBottom:'0.5px solid #0d1117'}}>
        <div style={S.raceTrack}>
          <div style={{...S.raceFill, width:`${pctTotal}%`, background:color, opacity:0.5}}/>
        </div>
        <span style={S.racePct}>{pctTotal}% grupo</span>
      </div>
      {execIds.length === 0 && (
        <div style={S.emptyRow}>Sin ejecutivos configurados</div>
      )}
      {execIds.map(id => {
        const metaV  = isMes ? (execs[id]?.metaMensual||0) : (execs[id]?.metaSemanal||0);
        const actual = (resultData||{})[id] || 0;
        const p      = metaV > 0 ? Math.min(100, Math.round(actual/metaV*100)) : 0;
        const nombre = execs[id]?.nombre || nombreById(id);
        return (
          <div key={id} style={S.raceRow}>
            <div style={S.raceTop}>
              <span style={S.raceName}>{nombre}</span>
              <span style={S.raceNums}>{actual} {colLabel?.toLowerCase()} / meta {metaV}</span>
            </div>
            <div style={S.raceTrack}>
              <div style={{...S.raceFill, width:`${p}%`, background:color}}/>
            </div>
            <span style={{...S.racePct, color: p>=100?'#10b981':undefined}}>{p}%{p>=100?' ✓':''}</span>
          </div>
        );
      })}
    </div>
  );
}

function PctBadge({ val, prev }) {
  const p = pct(val, prev);
  if (p === null) return null;
  const up = p >= 0;
  return (
    <span style={{
      fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:10,
      background: up?'#042f1e':'#2d0a0a',
      color: up?'#10b981':'#ef4444',
    }}>
      {up?'+':''}{p}%
    </span>
  );
}

function LoadingScreen() {
  return (
    <div style={{...S.app, display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:24,height:24,border:'2px solid #1e293b',borderTop:'2px solid #3b82f6',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
      <span style={{color:'#334155',fontSize:13,fontFamily:'monospace'}}>Cargando datos…</span>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app:        { background:'#070a10', minHeight:'100vh', fontFamily:"'DM Sans',system-ui,sans-serif", color:'#e2e8f0', padding:'14px 18px' },
  topBar:     { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 },
  logo:       { fontSize:11, fontWeight:700, letterSpacing:'4px', color:'#3b82f6', textTransform:'uppercase', fontFamily:'monospace', marginBottom:4 },
  title:      { fontSize:20, fontWeight:600, color:'#ffffff', letterSpacing:'-0.3px' },
  rightBar:   { display:'flex', alignItems:'center', gap:12 },
  weekPill:   { background:'#111827', border:'1px solid #2d3748', borderRadius:20, padding:'6px 16px', fontSize:13, color:'#94a3b8', fontFamily:'monospace' },
  weekVal:    { color:'#fbbf24', fontWeight:700 },
  tabs:       { display:'flex', gap:4 },
  tab:        { padding:'7px 16px', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', border:'none', background:'#111827', color:'#64748b' },
  tabActive:  { background:'#2563eb', color:'#fff', fontWeight:600 },
  refreshTime:{ fontSize:12, color:'#374151', fontFamily:'monospace' },
  kpiRow:     { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 },
  kpi:        { background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:12, padding:'16px 20px' },
  kpiLabel:   { fontSize:11, color:'#4b5563', letterSpacing:'1.5px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:10 },
  kpiVal:     { fontSize:40, fontWeight:700, color:'#ffffff', lineHeight:1, marginBottom:8 },
  kpiSub:     { fontSize:13, marginTop:2 },
  errorBox:   { background:'#1a0a0a', border:'1px solid #450a0a', borderRadius:8, padding:'12px 16px', color:'#ef4444', fontSize:13, marginBottom:14, fontFamily:'monospace' },
  sectionBlock:{ background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:12, padding:14, marginBottom:12 },
  sectionTitle:{ fontSize:15, fontWeight:600, color:'#ffffff', marginBottom:2 },
  sectionSub:  { fontSize:11, color:'#374151', letterSpacing:'1.5px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:12 },
  twoCol:     { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  card:       { background:'#111827', border:'0.5px solid #1e293b', borderRadius:10, overflow:'hidden' },
  cardHdr:    { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderBottom:'0.5px solid #1e293b' },
  cardTitle:  { fontSize:14, fontWeight:600, color:'#f1f5f9' },
  cardMeta:   { fontSize:11, color:'#4b5563' },
  raceRow:    { padding:'10px 14px', borderBottom:'0.5px solid #0f1620' },
  raceTop:    { display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 },
  raceName:   { fontSize:14, fontWeight:500, color:'#e2e8f0' },
  raceNums:   { fontSize:12, color:'#6b7280' },
  raceTrack:  { position:'relative', height:10, background:'#1a2535', borderRadius:5, overflow:'hidden', marginBottom:4 },
  raceFill:   { height:10, borderRadius:5, position:'absolute', top:0, left:0, transition:'width .4s ease' },
  racePct:    { fontSize:11, color:'#4b5563', fontFamily:'monospace', fontWeight:600 },
  emptyRow:   { padding:'14px', fontSize:12, color:'#374151', fontStyle:'italic' },
};
