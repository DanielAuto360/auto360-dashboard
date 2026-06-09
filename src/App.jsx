import React, { useState, useEffect, useCallback } from 'react';

const SHEET_ID = '1yopN8O-uwsCkYhevSmGnGaLPTHGcOjyHhRDtn3ranTo';
const API_KEY  = 'AIzaSyDepLhTVDuWyogq7Zj9lLFUG2K9-0B_gHU';
const REFRESH_MS = 5 * 60 * 1000;

// ─── UTILS ───────────────────────────────────────────────────────────────────
const sumObj = obj => Object.values(obj || {}).reduce((a, b) => a + b, 0);
const pct    = (a, b) => (b ? Math.round((a - b) / b * 100) : null);

// ─── WEEK UTILS (semanas reales del mes calendario) ───────────────────────────
// W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-31 (si el mes tiene esos días)
function getWeekRangesForMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const ranges = [
    { w: 'W1', start: 1,  end: 7  },
    { w: 'W2', start: 8,  end: 14 },
    { w: 'W3', start: 15, end: 21 },
    { w: 'W4', start: 22, end: 28 },
  ];
  if (daysInMonth > 28) ranges.push({ w: 'W5', start: 29, end: daysInMonth });
  return ranges;
}

function getWeekForDay(day, year, month) {
  const ranges = getWeekRangesForMonth(year, month);
  const r = ranges.find(r => day >= r.start && day <= r.end);
  return r ? r.w : null;
}

function getCurrentWeek() {
  const n = new Date();
  return getWeekForDay(n.getDate(), n.getFullYear(), n.getMonth() + 1) || 'W1';
}

function currentWeekRange() {
  const n = new Date();
  const ranges = getWeekRangesForMonth(n.getFullYear(), n.getMonth() + 1);
  const r = ranges.find(r => n.getDate() >= r.start && n.getDate() <= r.end);
  return r ? { start: r.start, end: r.end } : { start: 1, end: 7 };
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
function currentMonthYear() { const n = new Date(); return { month: n.getMonth()+1, year: n.getFullYear() }; }

// Parsea fecha dd/mm/yyyy o dd-mm-yyyy → { day, month, year } o null
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/-/g, '/');
  const p = s.split('/');
  if (p.length !== 3) return null;
  const day = parseInt(p[0]), month = parseInt(p[1]), year = parseInt(p[2]);
  if (!day || !month || !year) return null;
  return { day, month, year };
}

// ─── SHEETS FETCH ─────────────────────────────────────────────────────────────
async function fetchSheet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${range}`);
  return (await res.json()).values || [];
}

// ─── NAME NORMALIZATION ───────────────────────────────────────────────────────
function normName(s) { return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }

function buildNameMap(execRows) {
  const map = {};
  execRows.slice(1).forEach(row => {
    const id = (row[0]||'').trim();
    const nombre = (row[1]||'').trim();
    if (!id || !nombre) return;
    map[normName(nombre)] = { id, nombre };
    const parts = nombre.split(' ');
    if (parts.length >= 2) {
      const alias = `${parts[0]} ${parts[1][0]}.`;
      map[normName(alias)] = { id, nombre };
      map[normName(`${parts[0]} ${parts[1][0]}`)] = { id, nombre };
      // alias sin apellido
      map[normName(parts[0])] = { id, nombre };
    }
  });
  return map;
}

function resolveId(rawName, nameMap) {
  if (!rawName) return null;
  const n = normName(rawName);
  if (nameMap[n]) return nameMap[n].id;
  // busca por primer token
  const first = n.split(' ')[0];
  const found = Object.keys(nameMap).find(k => k.startsWith(first + ' ') || k === first);
  return found ? nameMap[found].id : null;
}

// ─── CONFIG ESTÁTICO ─────────────────────────────────────────────────────────
// Grupos, metas y ejecutivos hardcodeados según configuración real de Auto360.
// IDs según hoja Ejecutivos. Metas según captura del Sheets (junio 2026).
//
// Para actualizar metas: modificar los valores metaMensual / metaSemanal aquí.
//
// Ventas Stgo:  Javier H. (8935167)  19/5  | Pedro P. (11599928) 19/5
// Ventas Viña:  Victor T. (13188544)  9/2  | Tomas P. (13188552)  9/2
// Cons Stgo:    Matias P. (13804760) 18/5  | Tomas L. (14722736) 18/5 | Francisca R. (15277292) 18/5
// Cons Viña:    Yana N.   (14268040) 25/6
// Conv Ventas Stgo: Javier H. 238/59 | Pedro P. 238/59
// Conv Ventas Viña: Victor T. 113/28 | Tomas P. 113/28
// Conv Cons Stgo:   Matias P. 600/150 | Tomas L. 600/150 | Francisca R. 600/150
// Conv Cons Viña:   Yana N. 600/150

function buildStaticConfig(nameMap) {
  // Resuelve nombre → ID real desde la hoja Ejecutivos, con fallback al ID conocido
  const rid = (nombre, fallbackId) => resolveId(nombre, nameMap) || fallbackId;

  const jH = rid('Javier H.',    '8935167');
  const pP = rid('Pedro P.',     '11599928');
  const vT = rid('Victor T.',    '13188544');
  const tP = rid('Tomas P.',     '13188552');
  const mP = rid('Matias P.',    '13804760');
  const tL = rid('Tomas L.',     '14722736');
  const fR = rid('Francisca R.', '15277292');
  const yN = rid('Yana N.',      '14268040');

  const nombre = id => Object.values(nameMap).find(x => x.id === id)?.nombre || id;

  return {
    ventasStgo: {
      [jH]: { nombre: nombre(jH), metaMensual: 19, metaSemanal: 5 },
      [pP]: { nombre: nombre(pP), metaMensual: 19, metaSemanal: 5 },
    },
    ventasVina: {
      [vT]: { nombre: nombre(vT), metaMensual: 9,  metaSemanal: 2 },
      [tP]: { nombre: nombre(tP), metaMensual: 9,  metaSemanal: 2 },
    },
    consStgo: {
      [mP]: { nombre: nombre(mP), metaMensual: 18, metaSemanal: 5 },
      [tL]: { nombre: nombre(tL), metaMensual: 18, metaSemanal: 5 },
      [fR]: { nombre: nombre(fR), metaMensual: 18, metaSemanal: 5 },
    },
    consVina: {
      [yN]: { nombre: nombre(yN), metaMensual: 25, metaSemanal: 6 },
    },
    convVentasStgo: {
      [jH]: { metaMensual: 238, metaSemanal: 59 },
      [pP]: { metaMensual: 238, metaSemanal: 59 },
    },
    convVentasVina: {
      [vT]: { metaMensual: 113, metaSemanal: 28 },
      [tP]: { metaMensual: 113, metaSemanal: 28 },
    },
    convConsStgo: {
      [mP]: { metaMensual: 600, metaSemanal: 150 },
      [tL]: { metaMensual: 600, metaSemanal: 150 },
      [fR]: { metaMensual: 600, metaSemanal: 150 },
    },
    convConsVina: {
      [yN]: { metaMensual: 600, metaSemanal: 150 },
    },
  };
}

// ─── CONVERSACIONES PARSER ────────────────────────────────────────────────────
function parseConv(rows) {
  const byDate = {};
  rows.slice(1).forEach(row => {
    const fecha  = normDate((row[0]||'').trim());
    const execId = (row[1]||'').trim();
    const leads  = parseInt(row[2]) || 0;
    if (!fecha || !execId) return;
    if (!byDate[fecha]) byDate[fecha] = {};
    byDate[fecha][execId] = (byDate[fecha][execId]||0) + leads;
  });
  return byDate;
}

function getConvForPeriod(byDate, tab) {
  const keys = Object.keys(byDate);
  if (tab==='hoy')  return { ...(byDate[todayKey()]||{}) };
  if (tab==='ayer') return { ...(byDate[yesterdayKey()]||{}) };
  const { month, year } = currentMonthYear();
  if (tab==='semana') {
    const { start, end } = currentWeekRange();
    const merged = {};
    keys.forEach(k => {
      const [d,m,y] = k.split('/').map(Number);
      if (y===year && m===month && d>=start && d<=end) {
        Object.entries(byDate[k]).forEach(([id,v]) => { merged[id]=(merged[id]||0)+v; });
      }
    });
    return merged;
  }
  const merged = {};
  keys.forEach(k => {
    const [,m,y] = k.split('/').map(Number);
    if (y===year && m===month) {
      Object.entries(byDate[k]).forEach(([id,v]) => { merged[id]=(merged[id]||0)+v; });
    }
  });
  return merged;
}

// ─── DATA_COMPLETA PARSER ─────────────────────────────────────────────────────
// Columnas (0-indexed): A=0 patente, B=1 estado, C=2 fechaIngreso,
//   P=15 sucursal, AC=28 consignador, AH=33 fechaVenta, AN=39 vendedor
const COL = { estado:1, fechaIngreso:2, sucursal:15, consignador:28, fechaVenta:33, vendedor:39 };

function normSucursal(raw) {
  const s = (raw||'').trim().toLowerCase();
  if (s.includes('vi') || s.includes('ña') || s.includes('vina')) return 'vina';
  return 'stgo'; // default Santiago
}

function isCurrentMonth(pd) {
  if (!pd) return false;
  const { month, year } = currentMonthYear();
  return pd.month === month && pd.year === year;
}

function parseDataCompleta(rows, nameMap) {
  const { month, year } = currentMonthYear();
  const weekRanges = getWeekRangesForMonth(year, month);

  // Acumuladores: { [execId]: { mes: N, semana: N } }
  const ventas = {};
  const cons   = {};

  const initExec = (map, id) => {
    if (!map[id]) map[id] = { mes: 0, semana: 0 };
  };

  const currentWeekLabel = getCurrentWeek();

  rows.slice(1).forEach(row => {
    const estado      = (row[COL.estado]       || '').trim().toLowerCase();
    const sucursalRaw = (row[COL.sucursal]      || '').trim();
    const vendedorRaw = (row[COL.vendedor]      || '').trim();
    const consigRaw   = (row[COL.consignador]   || '').trim();
    const fechaVentaR = (row[COL.fechaVenta]    || '').trim();
    const fechaIngrR  = (row[COL.fechaIngreso]  || '').trim();

    const sucursal = normSucursal(sucursalRaw);

    // ── VENTAS: estado contiene "vendido" + tiene fecha de venta en el mes actual ──
    if (estado === 'vendido' || estado.includes('vendido')) {
      const fv = parseDate(fechaVentaR);
      if (fv && isCurrentMonth(fv)) {
        const id = resolveId(vendedorRaw, nameMap);
        if (id) {
          initExec(ventas, id);
          ventas[id].mes++;
          const w = getWeekForDay(fv.day, fv.year, fv.month);
          if (w === currentWeekLabel) ventas[id].semana++;
        }
      }
    }

    // ── CONSIGNAS: tiene consignador + fecha de ingreso en el mes actual ──
    if (consigRaw) {
      const fi = parseDate(fechaIngrR);
      if (fi && isCurrentMonth(fi)) {
        const id = resolveId(consigRaw, nameMap);
        if (id) {
          initExec(cons, id);
          cons[id].mes++;
          const w = getWeekForDay(fi.day, fi.year, fi.month);
          if (w === currentWeekLabel) cons[id].semana++;
        }
      }
    }
  });

  // Convertir a formato { mes: {id:N}, semana: {id:N} }
  const toFlat = (map, key) => Object.fromEntries(Object.entries(map).map(([id,v])=>[id,v[key]]));
  return {
    ventas: { mes: toFlat(ventas,'mes'), semana: toFlat(ventas,'semana') },
    cons:   { mes: toFlat(cons,  'mes'), semana: toFlat(cons,  'semana') },
  };
}

// ─── FETCH PRINCIPAL ──────────────────────────────────────────────────────────
async function fetchAll() {
  const [execRows, convRows, dataRows] = await Promise.all([
    fetchSheet('Ejecutivos!A:B'),
    fetchSheet('Dashboard Data - Mensajes!A:C'),
    fetchSheet('Data_Completa!A:AN'),
  ]);
  const nameMap  = buildNameMap(execRows);
  const convData = parseConv(convRows);
  const config   = buildStaticConfig(nameMap);
  const { ventas, cons } = parseDataCompleta(dataRows, nameMap);
  return { nameMap, convData, config, ventas, cons };
}

// ─── HELPERS UI ───────────────────────────────────────────────────────────────
function getTop(convMap, execIds) {
  let best=null, bestV=-1;
  execIds.forEach(id => { const v=convMap[id]||0; if(v>bestV){bestV=v;best=id;} });
  return { id:best, val:bestV };
}
function nombreById(id, nameMap) {
  return Object.values(nameMap).find(x=>x.id===id)?.nombre || id;
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function PctBadge({ val, prev }) {
  const p = pct(val, prev);
  if (p===null) return null;
  const up = p>=0;
  return <span style={{
    fontSize:12, fontWeight:700, padding:'2px 8px', borderRadius:10,
    background:up?'#042f1e':'#2d0a0a', color:up?'#10b981':'#ef4444', marginLeft:6,
  }}>{up?'+':''}{p}%</span>;
}

function RaceRow({ nombre, actual, meta, color, sublabel }) {
  const w = meta>0 ? Math.min(100, Math.round(actual/meta*100)) : 0;
  const over = actual > meta;
  return (
    <div style={{ padding:'11px 16px', borderBottom:'0.5px solid #0f1620' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
        <span style={{ fontSize:14, fontWeight:500, color:'#e5e7eb' }}>{nombre}</span>
        <span style={{ fontSize:13, color:'#9ca3af' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'#ffffff' }}>{actual}</span>
          {' '}{sublabel||''} / meta <span style={{ color:'#6b7280' }}>{meta}</span>
        </span>
      </div>
      <div style={{ height:11, background:'#1a2535', borderRadius:6, overflow:'hidden', marginBottom:4 }}>
        <div style={{ height:11, borderRadius:6, width:`${w}%`, background:over?'#10b981':color, transition:'width .4s' }}/>
      </div>
      <span style={{ fontSize:12, color: w>=100?'#10b981':'#4b5563', fontFamily:'monospace', fontWeight:600 }}>
        {w}%{w>=100?' ✓':''}
      </span>
    </div>
  );
}

function GroupCard({ label, color, execs, convMetas, resultData, convCur, convPrev, tab, tipo }) {
  const isMes = tab==='mes';
  const execIds = Object.keys(execs);
  if (execIds.length===0) return (
    <div style={S.card}>
      <div style={S.cardHdr}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:9,height:9,borderRadius:'50%',background:color}}/>
          <span style={S.cardTitle}>{label}</span>
        </div>
      </div>
      <div style={{padding:14,color:'#374151',fontSize:12,fontStyle:'italic'}}>Sin ejecutivos</div>
    </div>
  );

  if (tipo==='conv') {
    const totalMeta = execIds.reduce((a,id)=>{
      const m=convMetas?.[id]; return a+(isMes?(m?.metaMensual||0):(m?.metaSemanal||0));
    },0);
    const totalActual = execIds.reduce((a,id)=>a+(convCur[id]||0),0);
    return (
      <div style={S.card}>
        <div style={S.cardHdr}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:9,height:9,borderRadius:'50%',background:color}}/>
            <span style={S.cardTitle}>{label}</span>
          </div>
          <span style={S.cardMeta}>meta {totalMeta} conv/{isMes?'mes':'sem'}</span>
        </div>
        {execIds.map(id=>{
          const meta  = isMes?(convMetas?.[id]?.metaMensual||0):(convMetas?.[id]?.metaSemanal||0);
          const actual= convCur[id]||0;
          const prev  = convPrev[id]||0;
          const nombre= execs[id]?.nombre||'—';
          return (
            <div key={id} style={{padding:'11px 16px',borderBottom:'0.5px solid #0f1620'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                <span style={{fontSize:14,fontWeight:500,color:'#e5e7eb'}}>{nombre}</span>
                <div style={{display:'flex',alignItems:'center'}}>
                  <span style={{fontSize:15,fontWeight:700,color:'#ffffff'}}>{actual}</span>
                  <span style={{fontSize:12,color:'#6b7280',marginLeft:4}}>/ {meta}</span>
                  {prev>0 && <PctBadge val={actual} prev={prev}/>}
                </div>
              </div>
              <div style={{height:11,background:'#1a2535',borderRadius:6,overflow:'hidden',marginBottom:4}}>
                <div style={{height:11,borderRadius:6,width:`${Math.min(100,meta>0?Math.round(actual/meta*100):0)}%`,background:color,transition:'width .4s'}}/>
              </div>
              <span style={{fontSize:12,color:actual>=meta&&meta>0?'#10b981':'#4b5563',fontFamily:'monospace',fontWeight:600}}>
                {meta>0?Math.min(100,Math.round(actual/meta*100)):0}%{actual>=meta&&meta>0?' ✓':''}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // tipo === 'result'
  const totalMeta   = execIds.reduce((a,id)=>a+(isMes?(execs[id]?.metaMensual||0):(execs[id]?.metaSemanal||0)),0);
  const totalActual = execIds.reduce((a,id)=>a+((resultData||{})[id]||0),0);
  const pctGrupo    = totalMeta>0?Math.min(100,Math.round(totalActual/totalMeta*100)):0;
  return (
    <div style={S.card}>
      <div style={S.cardHdr}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:9,height:9,borderRadius:'50%',background:color}}/>
          <span style={S.cardTitle}>{label}</span>
        </div>
        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
          <span style={{fontSize:22,fontWeight:700,color:'#ffffff'}}>{totalActual}</span>
          <span style={{fontSize:12,color:'#4b5563'}}>/ meta {totalMeta}</span>
          <span style={{fontSize:12,fontWeight:700,color:pctGrupo>=100?'#10b981':'#94a3b8',fontFamily:'monospace'}}>{pctGrupo}%</span>
        </div>
      </div>
      <div style={{padding:'6px 16px 4px',borderBottom:'0.5px solid #0d1117'}}>
        <div style={{height:6,background:'#1a2535',borderRadius:3,overflow:'hidden'}}>
          <div style={{height:6,borderRadius:3,width:`${pctGrupo}%`,background:color,opacity:.5}}/>
        </div>
      </div>
      {execIds.map(id=>{
        const metaV = isMes?(execs[id]?.metaMensual||0):(execs[id]?.metaSemanal||0);
        const actual= (resultData||{})[id]||0;
        const nombre= execs[id]?.nombre||'—';
        return <RaceRow key={id} nombre={nombre} actual={actual} meta={metaV} color={color}/>;
      })}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]     = useState('hoy');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await fetchAll();
      setData(d);
      setLastRefresh(new Date());
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const iv=setInterval(load,REFRESH_MS); return ()=>clearInterval(iv); }, [load]);

  if (loading) return (
    <div style={{...S.app,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:24,height:24,border:'2px solid #1e293b',borderTop:'2px solid #3b82f6',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
      <span style={{color:'#334155',fontSize:13,fontFamily:'monospace'}}>Cargando datos…</span>
    </div>
  );

  const week   = getCurrentWeek();
  const isMes  = tab==='mes';
  const convCur  = data ? getConvForPeriod(data.convData, tab)    : {};
  const convPrev = data ? getConvForPeriod(data.convData, tab==='hoy'?'ayer':'mes') : {};
  const totCur   = sumObj(convCur);
  const totPrev  = sumObj(convPrev);
  const pctTot   = pct(totCur, totPrev);
  const ventasData = data ? (isMes ? data.ventas.mes : data.ventas.semana) : {};
  const consData   = data ? (isMes ? data.cons.mes   : data.cons.semana)   : {};

  // Top vendedor / consignador
  const ventasIds = data ? [...Object.keys(data.config.ventasStgo), ...Object.keys(data.config.ventasVina)] : [];
  const consIds   = data ? [...Object.keys(data.config.consStgo),   ...Object.keys(data.config.consVina)]   : [];
  const topV = data ? getTop(convCur, ventasIds) : null;
  const topC = data ? getTop(convCur, consIds)   : null;
  const topVNombre = topV?.id ? nombreById(topV.id, data.nameMap).split(' ')[0] : '—';
  const topCNombre = topC?.id ? nombreById(topC.id, data.nameMap).split(' ')[0] : '—';
  const timeStr = lastRefresh ? `${lastRefresh.getHours()}:${lastRefresh.getMinutes().toString().padStart(2,'0')}` : '–';

  return (
    <div style={S.app}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={S.topBar}>
        <div>
          <div style={S.logo}>Auto360</div>
          <div style={S.title}>Supervisión Comercial</div>
        </div>
        <div style={S.rightBar}>
          <div style={S.weekPill}>Semana <span style={S.weekVal}>{week}</span></div>
          <div style={S.tabs}>
            {[['hoy','Hoy'],['ayer','Ayer'],['semana','Esta semana'],['mes','Este mes']].map(([k,l])=>(
              <button key={k} style={k===tab?{...S.tab,...S.tabActive}:S.tab} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>
          <span style={S.refreshTime}>↻ {timeStr}</span>
        </div>
      </div>

      {error && <div style={S.errorBox}>⚠ {error}</div>}

      <div style={S.kpiRow}>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Total conversaciones</div>
          <div style={S.kpiVal}>{totCur}</div>
          {pctTot!==null && (
            <div style={{...S.kpiSub, color:pctTot>=0?'#10b981':'#ef4444'}}>
              {pctTot>=0?'↑ +':'↓ '}{Math.abs(pctTot)}% vs período anterior
            </div>
          )}
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top vendedor</div>
          <div style={{...S.kpiVal,fontSize:18,paddingTop:4}}>
            {topV?.val>0?`${topVNombre} — ${topV.val} conv.`:'—'}
          </div>
          <div style={{...S.kpiSub,color:'#3b82f6'}}>por conversaciones</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Top consignador</div>
          <div style={{...S.kpiVal,fontSize:18,paddingTop:4}}>
            {topC?.val>0?`${topCNombre} — ${topC.val} conv.`:'—'}
          </div>
          <div style={{...S.kpiSub,color:'#10b981'}}>por conversaciones</div>
        </div>
      </div>

      {data && <>
        {/* SECCIÓN 1: CONVERSACIONES */}
        <div style={S.sectionBlock}>
          <div style={S.sectionTitle}>Conversaciones</div>
          <div style={S.sectionSub}>avance vs meta — {isMes?'este mes':tab==='semana'?'esta semana':tab}</div>
          <div style={S.twoCol}>
            <GroupCard label="Ventas Santiago"    color="#3b82f6" execs={data.config.ventasStgo} convMetas={data.config.convVentasStgo} convCur={convCur} convPrev={convPrev} tab={tab} tipo="conv"/>
            <GroupCard label="Ventas Viña"        color="#8b5cf6" execs={data.config.ventasVina} convMetas={data.config.convVentasVina} convCur={convCur} convPrev={convPrev} tab={tab} tipo="conv"/>
            <GroupCard label="Consignas Santiago" color="#10b981" execs={data.config.consStgo}   convMetas={data.config.convConsStgo}   convCur={convCur} convPrev={convPrev} tab={tab} tipo="conv"/>
            <GroupCard label="Consignas Viña"     color="#f59e0b" execs={data.config.consVina}   convMetas={data.config.convConsVina}   convCur={convCur} convPrev={convPrev} tab={tab} tipo="conv"/>
          </div>
        </div>

        {/* SECCIÓN 2: RESULTADOS */}
        <div style={{...S.sectionBlock,marginBottom:0,borderColor:'#1e3a5f'}}>
          <div style={S.sectionTitle}>Resultados reales</div>
          <div style={S.sectionSub}>ventas y consignaciones vs meta — {isMes?'este mes':'esta semana'}</div>
          <div style={S.twoCol}>
            <GroupCard label="Ventas Santiago"    color="#3b82f6" execs={data.config.ventasStgo} resultData={ventasData} tab={tab} tipo="result"/>
            <GroupCard label="Ventas Viña"        color="#8b5cf6" execs={data.config.ventasVina} resultData={ventasData} tab={tab} tipo="result"/>
            <GroupCard label="Consignas Santiago" color="#10b981" execs={data.config.consStgo}   resultData={consData}   tab={tab} tipo="result"/>
            <GroupCard label="Consignas Viña"     color="#f59e0b" execs={data.config.consVina}   resultData={consData}   tab={tab} tipo="result"/>
          </div>
        </div>
      </>}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app:         { background:'#070a10', minHeight:'100vh', fontFamily:"'DM Sans',system-ui,sans-serif", color:'#e2e8f0', padding:'14px 18px' },
  topBar:      { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 },
  logo:        { fontSize:11, fontWeight:700, letterSpacing:'4px', color:'#3b82f6', textTransform:'uppercase', fontFamily:'monospace', marginBottom:4 },
  title:       { fontSize:20, fontWeight:600, color:'#ffffff' },
  rightBar:    { display:'flex', alignItems:'center', gap:12 },
  weekPill:    { background:'#111827', border:'1px solid #2d3748', borderRadius:20, padding:'6px 16px', fontSize:13, color:'#94a3b8', fontFamily:'monospace' },
  weekVal:     { color:'#fbbf24', fontWeight:700 },
  tabs:        { display:'flex', gap:4 },
  tab:         { padding:'7px 16px', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', border:'none', background:'#111827', color:'#64748b' },
  tabActive:   { background:'#2563eb', color:'#fff', fontWeight:600 },
  refreshTime: { fontSize:12, color:'#374151', fontFamily:'monospace' },
  kpiRow:      { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 },
  kpi:         { background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:12, padding:'16px 20px' },
  kpiLabel:    { fontSize:11, color:'#4b5563', letterSpacing:'1.5px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:10 },
  kpiVal:      { fontSize:40, fontWeight:700, color:'#ffffff', lineHeight:1, marginBottom:8 },
  kpiSub:      { fontSize:13, marginTop:2 },
  errorBox:    { background:'#1a0a0a', border:'1px solid #450a0a', borderRadius:8, padding:'12px 16px', color:'#ef4444', fontSize:13, marginBottom:14, fontFamily:'monospace' },
  sectionBlock:{ background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:12, padding:14, marginBottom:12 },
  sectionTitle:{ fontSize:16, fontWeight:700, color:'#ffffff', marginBottom:2 },
  sectionSub:  { fontSize:11, color:'#374151', letterSpacing:'1.5px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:12 },
  twoCol:      { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  card:        { background:'#111827', border:'0.5px solid #1e293b', borderRadius:10, overflow:'hidden' },
  cardHdr:     { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'0.5px solid #1e293b' },
  cardTitle:   { fontSize:15, fontWeight:700, color:'#f1f5f9' },
  cardMeta:    { fontSize:11, color:'#4b5563' },
};
