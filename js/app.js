let ITEMS_EXTRA={};

/* ===================== CÁLCULOS ===================== */
const fmtCLP = n => n==null?'—':'$'+Math.round(n).toLocaleString('es-CL');
const fmtUSD = n => n==null?'—':'US$ '+Math.round(n).toLocaleString('es-CL');
const fmtN = (n,d=0) => n==null||!isFinite(n)?'—':Number(n).toLocaleString('es-CL',{maximumFractionDigits:d,minimumFractionDigits:d});
const D = s => s?new Date(s+'T12:00:00'):null;
const fmtD = s => s?D(s).toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'2-digit'}).replace('.',''):'—';
const addDays=(d,n)=>new Date(d.getTime()+n*864e5);
const diff=(a,b)=>Math.round((D(b)-D(a))/864e5);

function calc(s){
  const p=P[s.linea];
  const tr=(TRANSITO[s.sku]||[]);
  const transito=tr.reduce((a,t)=>a+t.q,0);
  const eta=tr.length?tr[0].eta:null;
  let prom=0, mesesQ=[];
  if(s.ventas){
    const ult6=s.ventas.slice(-6);
    const conVenta=ult6.filter(v=>v>0);
    prom=conVenta.length?conVenta.reduce((a,b)=>a+b,0)/conVenta.length:0;
    s.ventas.forEach((v,i)=>{ if(v===0 && i>0) mesesQ.push(i); });
  }
  prom*=p.est;
  const diaria=prom/30;
  const ss=diaria*p.ss;
  const rop=diaria*p.lt+ss;
  const pos=s.stock+transito;
  const cob=diaria>0?pos/diaria:Infinity;
  const target=diaria*(p.lt+p.rev)+ss;
  let estado, sug=0, pedirAntes=null;
  if(s.desc){estado='desc'}
  else if(s.nuevo){estado='nuevo'}
  else if(diaria===0){estado=s.stock>0?'sobre':'nuevo'}
  else{
    if(pos<rop){estado='comprar'}
    else if(pos<rop+diaria*p.rev){estado='planificar'}
    else if(cob>180){estado='sobre'}
    else estado='ok';
    if(s.stock===0 && !transito) estado='quiebre';
    else if(s.stock===0 && transito) estado='riesgo';
    else if(transito && eta && s.stock < diaria*diff(HOY_S,eta)) estado='riesgo';
    if(estado==='comprar'||estado==='planificar'||estado==='quiebre') sug=Math.ceil(Math.max(0,target-pos)/p.moq)*p.moq;
    pedirAntes=addDays(HOY,Math.max(0,(pos-rop)/diaria));
  }
  const costoNN = s.fob? s.fob*TC*p.factor : null;
  const costo2e = costoNN? costoNN/(1-p.margen/100) : null;
  return {...s,p,transito,eta,prom,diaria,ss,rop,pos,cob,sug,estado,pedirAntes,mesesQ,costoNN,costo2e};
}
const EST = {
  quiebre:['Quiebre','s-quiebre'], riesgo:['Quiebre hasta llegada','s-riesgo'], comprar:['Comprar ya','s-comprar'],
  planificar:['Planificar','s-planificar'], ok:['OK','s-ok'], sobre:['Sobrestock','s-sobre'], nuevo:['Sin historial','s-nuevo'], desc:['Descontinuado','s-nuevo']
};
const chip=(e)=>`<span class="chip ${EST[e][1]}">${EST[e][0]}</span>`;
const ORD={quiebre:0,comprar:1,riesgo:2,planificar:3,ok:4,sobre:5,nuevo:6,desc:7};

/* ===================== UI ===================== */
const TABS=[['resumen','Resumen'],['reposicion','Reposición por SKU'],['importaciones','Importaciones'],['nueva','Nueva importación'],['caja','Flujo de caja'],['correos','Correos'],['carga','Carga de datos']];
let cur='resumen', filtroLinea='Todas';
const $=s=>document.querySelector(s);
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}

const ICONS={
 resumen:'<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
 reposicion:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
 importaciones:'<svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
 caja:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.9 0 2.7 5 1.4 5 4.2 0 1.2-1.1 1.9-2.5 1.9-1.1 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5"/></svg>',
 carga:'<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>'
};
ICONS.nueva='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
ICONS.correos='<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
const SHORT={resumen:'Resumen',reposicion:'Reposición',importaciones:'Importaciones',nueva:'Nueva',caja:'Caja',correos:'Correos',carga:'Carga'};
function renderTabs(){
  const activa=k=>k===cur||(cur==='ficha'&&k===(fichaNueva?'nueva':'importaciones'));
  $('#tabs').innerHTML=TABS.filter(([k])=>k!=='nueva'||EDITOR).map(([k,l])=>`<button ${activa(k)?'aria-current="page"':''} data-k="${k}" title="${l}">${ICONS[k]}<span>${SHORT[k]}</span></button>`).join('');
  $('#tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(b.dataset.k==='nueva'){nuevaFicha();return}cur=b.dataset.k;try{localStorage.setItem('pc-tab',cur)}catch(e){}render();window.scrollTo(0,0)});
}
function topline(){
  const hh=CARGADO_EN?CARGADO_EN.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}):'—';
  const pend=CORREOS.filter(c=>c.estado==='por asignar').length;
  const qa=window.ENTORNO==='QA';
  return `<div class="topline"><span class="title"><b>retail.cl</b> · Importaciones</span>${qa?'<span class="chip s-quiebre" title="Ambiente de pruebas: los cambios no tocan el Sheets de producción">QA · datos de prueba</span>':''}
   <span class="chip ${EDITOR?'s-ok':'s-sobre'}">${EDITOR?'Editor':'Solo lectura'}</span>
   <div class="sync"><span class="chip s-ok" title="Stock y ventas de Defontana">Stock ${CFG.stock_fecha?fmtD(CFG.stock_fecha):'—'}</span><span class="chip s-ok" title="${qa?'Datos de prueba guardados en el artifact':'Datos leídos del Sheets'}">${qa?'Datos QA':'Sheets'} ${hh}</span>${pend?`<span class="chip s-comprar">${pend} correo${pend>1?'s':''} por asignar</span>`:''}
   <span id="save-st" class="hint"></span>${qa?'<button class="btn" id="reiniciar-qa" title="Vuelve los datos de prueba a la copia inicial">Reiniciar QA</button>':''}<button class="btn" id="recargar" title="Volver a leer el Sheets">Actualizar</button>
   <span class="hint" title="${USUARIO?.email||''}">${USUARIO?.name||USUARIO?.email||''}</span><button class="btn" id="salir">Salir</button></div></div>`}
function render(){
  renderTabs();
  const v={resumen,reposicion,importaciones,caja,carga,correos:correosView,ficha:fichaView}[cur]();
  $('#main').innerHTML=topline()+v;
  ({resumen:bindResumen,reposicion:bindRepo,importaciones:bindImp,caja:bindCaja,carga:bindCarga,correos:bindCorreos,ficha:bindFicha})[cur]();
  $('#recargar').onclick=recargar; $('#salir').onclick=salir;
  const rq=$('#reiniciar-qa'); if(rq) rq.onclick=async()=>{if(!confirm('¿Volver los datos de prueba a la copia inicial? Se pierden los cambios hechos en QA.'))return;try{await G.reiniciar();await Store.cargar();toast('Datos de QA reiniciados.');render()}catch(err){toast(err.message)}};
  if(!EDITOR) soloLectura($('#main'));
  pintarGuardado();
}

/* ---------- RESUMEN ---------- */
function resumen(){
  const rows=SKUS.map(calc);
  const valor=rows.reduce((a,r)=>a+r.valor,0);
  const urg=rows.filter(r=>['quiebre','comprar','riesgo'].includes(r.estado));
  const enCamino=EMB.filter(e=>e.estado!=='Recibido');
  const uCamino=enCamino.reduce((a,e)=>a+(e.u||0),0), fobCamino=enCamino.reduce((a,e)=>a+e.fob,0);
  const caja90=todosPagos().filter(p=>p.estado==='Proyectado'&&p.fecha<=addD(HOY_S,90)).reduce((a,p)=>a+p.clp,0);
  const sobre=rows.filter(r=>r.estado==='sobre').reduce((a,r)=>a+r.valor,0);
  const alerts=rows.filter(r=>!['ok','nuevo','desc'].includes(r.estado)).sort((a,b)=>ORD[a.estado]-ORD[b.estado]).slice(0,7);
  return `<section class="view">
   <div class="head"><div><h2 style="font-size:22px;margin-top:4px">Resumen de compras</h2></div></div>
   <div class="kpis">
    <div class="kpi"><span class="eyebrow">Stock valorizado</span><span class="v num">${fmtCLP(valor)}</span><span class="d">Costo 2ebox · BD001 + BD002 + Full ML</span></div>
    <div class="kpi alert"><span class="eyebrow">SKUs a atender</span><span class="v num">${urg.length}</span><span class="d">${rows.filter(r=>r.estado==='quiebre').length} en quiebre · ${rows.filter(r=>r.estado==='riesgo').length} sin stock hasta que llegue la carga</span></div>
    <div class="kpi"><span class="eyebrow">En camino</span><span class="v num">${fmtN(uCamino)} u</span><span class="d">${enCamino.length} importaciones · ${fmtUSD(fobCamino)} FOB</span></div>
    <div class="kpi"><span class="eyebrow">Caja comprometida 90 días</span><span class="v num">${fmtCLP(caja90)}</span><span class="d">Pagos proyectados hasta el ${fmtD(addD(HOY_S,90))}, incluye IVA recuperable</span></div>
   </div>
   <div class="grid-3-1">
    <div class="panel"><header><h3>Acciones de compra</h3><span class="sub">Ordenadas por urgencia · clic para ver el detalle</span></header>
      <div class="alerts">${alerts.map(r=>`<div class="alert click" data-sku="${r.sku}" style="cursor:pointer">${chip(r.estado)}
        <div><div class="t">${r.nombre} <span class="mono" style="color:var(--ink-3)">${r.sku}</span></div>
        <div class="m">${accion(r)}</div></div>
        <div class="num" style="text-align:right">${r.sug?`<b>${fmtN(r.sug)} u</b><div class="m">sugerido</div>`:`<b>${isFinite(r.cob)?fmtN(r.cob)+' d':'—'}</b><div class="m">cobertura</div>`}</div></div>`).join('')}</div>
    </div>
    <div class="panel"><header><h3>Tiempo real pedido → bodega</h3><span class="sub">Medido en 11 importaciones</span></header>
      ${ltTable()}
      <div class="note" style="margin-top:12px">Sobrestock inmovilizado: <b class="num">${fmtCLP(sobre)}</b> (más de 180 días de cobertura). </div>
    </div>
   </div>
   <div class="panel"><header><h3>Línea de tiempo de importaciones</h3><span class="sub">Producción · tránsito marítimo · aduana y traslado a bodega</span>
     <div class="legend" style="margin-left:auto"><span><i class="g-prod"></i>Producción</span><span><i class="g-trans"></i>Tránsito</span><span><i class="g-adu"></i>Aduana → bodega</span><span><i class="g-total"></i>Sin desglose</span><span><i class="g-prod g-est"></i>Estimado</span></div></header>
     <div class="tbl-wrap">${gantt()}</div></div>
  </section>`;
}
function accion(r){
  const p=r.p;
  if(r.estado==='quiebre') return `Sin stock ni carga en camino. Venta promedio ${fmtN(r.prom,1)} u/mes. ${r.linea==='Reolink'?'Pedido aéreo: llega en ~'+p.lt+' días.':'Lead time '+p.lt+' días.'}`;
  if(r.estado==='riesgo') return `${r.stock} u en bodega; llegan ${fmtN(r.transito)} u el ${fmtD(r.eta)} (${r.p.prov}). Faltan ~${fmtN(Math.max(0,r.diaria*diff(HOY_S,r.eta)-r.stock))} u para cubrir hasta la llegada.`;
  if(r.estado==='comprar') return `Bajo el punto de reorden (${fmtN(r.rop)} u). Pedir ahora para no quebrar.`;
  if(r.estado==='planificar') return `Llega al punto de reorden el ${r.pedirAntes.toLocaleDateString('es-CL')}.`;
  if(r.estado==='desc') return 'Reemplazado por ACC-0088. Vender saldo, no reponer.';
  if(r.estado==='sobre') return r.diaria? `${fmtN(r.cob)} días de cobertura con la venta actual. No reponer; evaluar promoción.` : `Sin ventas registradas. Ingresó a stock recientemente o no rota.`;
  return '';
}
function ltTable(){
  const g={Chimeneas:[],Telones:[],Reolink:[]};
  EMB.filter(e=>e.bodega).forEach(e=>g[e.linea].push(e));
  return `<table><thead><tr><th>Línea</th><th class="r">Días</th><th class="r">Rango</th><th class="r">Usado en plan</th></tr></thead><tbody>${
   Object.entries(g).map(([l,es])=>{const d=es.map(e=>diff(e.pedido,e.bodega)).sort((a,b)=>a-b);const med=d[Math.floor(d.length/2)];
   return `<tr><td>${l}<div class="hint">${es.length} embarques</div></td><td class="r num"><b>${med}</b></td><td class="r num">${d[0]}–${d[d.length-1]}</td><td class="r num">${P[l].lt} d</td></tr>`}).join('')}
   </tbody></table><p class="hint" style="margin:8px 0 0">Chimeneas tarda más por producción (~80 días en Longhua). En Reolink el plan asume envío aéreo.</p>`;
}
function gantt(){
  const start=D('2025-03-01'), end=D('2027-01-31'), span=(end-start);
  const x=s=>((D(s)-start)/span*100).toFixed(2)+'%';
  const w=(a,b)=>((D(b)-D(a))/span*100).toFixed(2)+'%';
  const meses=[];for(let d=new Date(start);d<end;d.setMonth(d.getMonth()+1))meses.push(new Date(d));
  const scale=`<div class="g-scale" style="grid-template-columns:repeat(${meses.length},1fr)">${meses.map(m=>`<span>${m.getMonth()===0?'<b>'+m.getFullYear()+'</b>':m.toLocaleDateString('es-CL',{month:'short'}).replace('.','')}</span>`).join('')}</div>`;
  const rows=EMB.map(e=>{
    let segs='';
    const z=e.zarpe||e.zarpeEst, d=e.din||e.dinEst, b=e.bodega||e.bodegaEst;
    const est=(k)=>!e[k]?' g-est':'';
    if(z&&d&&b){
      segs+=`<div class="g-seg g-prod${est('zarpe')}" style="left:${x(e.pedido)};width:${w(e.pedido,z)}"></div>`;
      segs+=`<div class="g-seg g-trans${est('din')}" style="left:${x(z)};width:${w(z,d)}"></div>`;
      segs+=`<div class="g-seg g-adu${est('bodega')}" style="left:${x(d)};width:${w(d,b)}"></div>`;
    }else if(z){
      segs+=`<div class="g-seg g-prod" style="left:${x(e.pedido)};width:${w(e.pedido,z)}"></div>`;
      if(b) segs+=`<div class="g-seg g-trans g-est" style="left:${x(z)};width:${w(z,b)}"></div>`;
    }else if(b){
      segs+=`<div class="g-seg g-total${e.bodega?'':' g-est'}" style="left:${x(e.pedido)};width:${w(e.pedido,b)}"></div>`;
    }
    return `<div class="g-row"><div class="lbl">${e.id} <span class="hint">${e.u?fmtN(e.u)+' u':''}</span></div><div class="g-track">${segs}</div></div>`;
  }).join('');
  return `<div class="gantt">${scale}<div style="position:relative">${rows}<div class="g-today" style="left:calc(170px + (100% - 170px) * ${(HOY-start)/span})"><span>Hoy</span></div></div></div>`;
}
function bindResumen(){document.querySelectorAll('[data-sku]').forEach(el=>el.onclick=()=>skuDrawer(el.dataset.sku))}

/* ---------- REPOSICIÓN ---------- */
function reposicion(){
  const rows=SKUS.map(calc).filter(r=>filtroLinea==='Todas'||r.linea===filtroLinea);
  const lineas=['Chimeneas','Telones','Reolink'].filter(l=>filtroLinea==='Todas'||l===filtroLinea);
  return `<section class="view">
   <div class="head"><div><h2 style="font-size:22px;margin-top:4px">Reposición por SKU</h2>
    <p>Demanda = promedio mensual de los últimos 6 meses, sin contar meses en cero (quiebres). Posición = stock + en camino. Sugerido = demanda de (lead time + 30 días de revisión) + stock de seguridad − posición, redondeado al mínimo de compra.</p></div>
    <div class="actions"><div class="seg" id="fl">${['Todas','Chimeneas','Telones','Reolink'].map(l=>`<button aria-pressed="${l===filtroLinea}" data-l="${l}">${l}</button>`).join('')}</div></div></div>
   <div class="panel"><div class="tbl-wrap"><table>
    <thead><tr><th>Estado</th><th>Producto</th><th class="r">Stock</th><th class="r">En camino</th><th class="r">Venta/mes</th><th>12 meses</th><th class="r">Cobertura</th><th class="r">P. reorden</th><th>Posición vs reorden</th><th class="r">Sugerido</th><th class="r">Pedir antes de</th><th class="r">Costo 2ebox</th></tr></thead>
    <tbody>${lineas.map(l=>{
      const p=P[l];
      const rs=rows.filter(r=>r.linea===l).sort((a,b)=>ORD[a.estado]-ORD[b.estado]);
      return `<tr class="grp"><td colspan="12">${l} · LT ${p.lt} d · seguridad ${p.ss} d · margen Netnow ${p.margen}% · ${p.via}</td></tr>`+rs.map(r=>`<tr class="click" data-sku="${r.sku}">
        <td>${chip(r.estado)}</td>
        <td><div class="prod"><span>${r.nombre}</span><small class="mono">${r.sku}</small></div></td>
        <td class="r">${fmtN(r.stock)}</td>
        <td class="r">${r.transito?`${fmtN(r.transito)}<div class="hint">${fmtD(r.eta)}</div>`:'—'}</td>
        <td class="r">${r.ventas?fmtN(r.prom,1):'—'}</td>
        <td>${spark(r)}</td>
        <td class="r">${isFinite(r.cob)?fmtN(r.cob)+' d':'—'}</td>
        <td class="r">${r.diaria?fmtN(r.rop):'—'}</td>
        <td>${r.diaria?posBar(r):''}</td>
        <td class="r">${r.sug?`<b>${fmtN(r.sug)}</b>`:'—'}</td>
        <td class="r">${r.pedirAntes&&r.estado!=='sobre'?r.pedirAntes.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'2-digit'}):'—'}</td>
        <td class="r">${fmtCLP(r.costo2e)}</td></tr>`).join('');
    }).join('')}</tbody></table></div>
    <p class="hint" style="margin:10px 0 0">Packs <span class="mono">-2</span> (cámara + panel) suman a la cámara base y al panel <span class="mono">ACC-0084</span>. Telones <span class="mono">-2</span> agrupados con su SKU base hasta confirmar. Costo 2ebox = FOB × T/C ${TC} × factor de importación ÷ (1 − margen Netnow).</p>
   </div></section>`;
}
function spark(r){
  if(!r.ventas) return '<span class="hint">sin historial</span>';
  const max=Math.max(...r.ventas,1), W=96, H=26, bw=W/12;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="ventas 12 meses">${r.ventas.map((v,i)=>{const h=Math.max(v/max*(H-2),v?2:1);return `<rect x="${i*bw+1}" y="${H-h}" width="${bw-2}" height="${h}" rx="1" fill="${v?'var(--violet)':'var(--line)'}" opacity="${i>=6?1:.45}"></rect>`}).join('')}</svg>`;
}
function posBar(r){
  const max=Math.max(r.pos,r.rop*2,1);
  return `<div class="bar" title="Posición ${fmtN(r.pos)} · reorden ${fmtN(r.rop)}"><i style="width:${Math.min(100,r.pos/max*100)}%;background:${r.pos<r.rop?'var(--bad)':'var(--violet)'}"></i><b style="left:${r.rop/max*100}%"></b></div>`;
}
function bindRepo(){
  document.querySelectorAll('#fl button').forEach(b=>b.onclick=()=>{filtroLinea=b.dataset.l;render()});
  document.querySelectorAll('tr[data-sku]').forEach(el=>el.onclick=()=>skuDrawer(el.dataset.sku));
}

/* ---------- IMPORTACIONES ---------- */
const FIL={linea:new Set(),prov:new Set(),estado:new Set()}; let qImp='';
let filtrosAbiertos=true; try{filtrosAbiertos=localStorage.getItem('pc-fil')!=='0'}catch(e){}
const pass=(k,v)=>!FIL[k].size||FIL[k].has(v);
function embFiltrados(sinEstado){
  return EMB.filter(e=>pass('linea',e.linea)&&pass('prov',e.prov)&&(sinEstado||pass('estado',e.estado))&&
    (!qImp||[e.id,e.ref,e.klog,e.desc,e.prov].join(' ').toLowerCase().includes(qImp.toLowerCase())));
}
const ICO_SHIP='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15h18l-2.5 5h-13zM6 15V9h12v6M9 9V5h6v4"/></svg>';
const ICO_AIR='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.8 0 1.5.7 1.5 1.5V9l7 4v2l-7-2v4.5l2 1.5v1.5L12 20l-3.5.5V19l2-1.5V13l-7 2v-2l7-4V4.5C10.5 3.7 11.2 3 12 3z"/></svg>';
const ICO_LOCAL='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/></svg>';
function dcell(real,est){return real?fmtD(real):est?`<span class="hint">~${fmtD(est)}</span>`:'<span class="hint">—</span>'}
const campo=(e,k)=>k==='linea'?e.linea:k==='prov'?e.prov:e.estado;
function importaciones(){
  const rows=embFiltrados().slice().sort((a,b)=>D(b.pedido)-D(a.pedido));
  const base=embFiltrados(true);
  const cnt=k=>base.filter(e=>e.estado===k).length;
  const soloEst=FIL.estado.size===1?[...FIL.estado][0]:null;
  const kcard=(k,l,n)=>`<button class="kpi kbtn" data-est="${k}" aria-pressed="${k==='*'?!FIL.estado.size:soloEst===k}"><span class="eyebrow">${l}</span><span class="v num">${n}</span><span class="d">${k==='*'?'Ver todas':(soloEst===k?'Filtrando · clic para quitar':'Clic para filtrar')}</span></button>`;
  const nAct=Object.values(FIL).reduce((a,x)=>a+x.size,0);
  const grupos=[['linea','Tipo de producto',['Chimeneas','Telones','Reolink']],['prov','Proveedor',[...new Set(EMB.map(e=>e.prov))]],['estado','Estado',['En cotización','En producción','En tránsito','Recibido']]];
  const filtros=grupos.map(([k,l,vals])=>`<fieldset class="fg"><legend>${l}</legend>${vals.map(v=>{const n=EMB.filter(e=>campo(e,k)===v).length;
     return `<label class="ck"><input type="checkbox" data-fk="${k}" value="${v}" ${FIL[k].has(v)?'checked':''}><span>${v}</span><em>${n}</em></label>`}).join('')}</fieldset>`).join('');
  return `<section class="view">
   <div class="head"><div><h2 style="font-size:22px;margin-top:4px">Importaciones</h2></div></div>
   <div class="kpis">
    ${kcard('En cotización','En cotización',cnt('En cotización'))}
    ${kcard('En producción','En producción',cnt('En producción'))}
    ${kcard('En tránsito','En tránsito',cnt('En tránsito'))}
    ${kcard('Recibido','Recibidas',cnt('Recibido'))}
    ${kcard('*','Total',base.length)}
   </div>
   <div class="imp-layout ${filtrosAbiertos?'':'closed'}">
    <aside class="panel filters" ${filtrosAbiertos?'':'hidden'}><div style="display:flex;align-items:center;gap:6px"><h3 style="flex:1">Filtros</h3>${Object.values(FIL).some(x=>x.size)?'<button class="lnk" id="clr" style="background:none;border:0;cursor:pointer;font-size:12px">Limpiar</button>':''}<button class="icbtn" id="ocultar" title="Ocultar filtros" aria-label="Ocultar filtros"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button></div>${filtros}</aside>
    <div class="panel" style="min-width:0">
     <div class="toolbar"><button class="btn ${filtrosAbiertos?'soft':''}" id="tgl" aria-expanded="${filtrosAbiertos}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-3px;margin-right:6px"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros${nAct?` <span class="badge">${nAct}</span>`:''}</button><div class="search"><input id="q" placeholder="Buscar referencia, importación o proveedor" value="${qImp.replace(/"/g,'&quot;')}"></div>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap"><button class="btn soft" id="subir-pi">Subir PI</button><button class="btn primary" id="nueva">+ Nueva importación</button></div></div>
     <div class="tbl-wrap"><table class="imp">
      <thead><tr><th class="stk">Referencia</th><th>Importación</th><th>Estado</th><th>Descripción mercadería</th><th>Tipo embarque</th><th>Proveedor</th><th class="r">Unidades</th><th class="r">FOB</th><th>POL</th><th>ETD</th><th>ETA inicial</th><th>ETA</th><th>Fecha en CD</th><th class="r">Tiempo total</th><th class="r">Tránsito</th><th>Documentos</th><th>Alertas</th></tr></thead>
      <tbody>${rows.length?rows.map(e=>{
        const nd=Object.values(e.docs).filter(x=>x).length, td=Object.keys(e.docs).length;
        const st=e.estado==='Recibido'?'s-ok':e.estado==='En tránsito'?'s-planificar':e.estado==='En cotización'?'s-sobre':'s-comprar';
        const cd=e.bodega||e.bodegaEst, etd=e.zarpe||e.zarpeEst;
        const total=cd?diff(e.pedido,cd):null, tr=(etd&&cd)?diff(etd,cd):null, est=!e.bodega;
        const eta=e.eta?fmtD(e.eta):e.din?`${fmtD(e.din)}<div class="hint">según DIN</div>`:e.etaEst?`<span class="hint">~${fmtD(e.etaEst)}</span>`:'<span class="hint">—</span>';
        const tico=e.tipo==='Aéreo'?ICO_AIR:e.tipo==='Local'?ICO_LOCAL:ICO_SHIP;
        const alertas=[!e.ref?'Falta referencia':null,!e.din&&e.estado==='Recibido'&&e.tipo!=='Aéreo'?'Falta DIN':null,e.alerta].filter(Boolean);
        return `<tr class="click" data-emb="${e.id}">
         <td class="stk"><span class="lnk mono">${e.ref||'<span style="color:var(--bad)">Sin ref.</span>'}</span>${e.klog?`<div class="hint mono">${e.klog}</div>`:''}</td>
         <td><span class="lnk">${e.id}</span><div class="hint">${e.linea}</div></td>
         <td><span class="chip ${st}">${e.estado}</span></td>
         <td style="white-space:normal;min-width:200px;max-width:240px">${e.desc||'—'}</td>
         <td><span style="display:inline-flex;gap:6px;align-items:center;color:var(--link)">${tico}<span style="color:var(--ink)">${e.tipo||'—'}</span></span><div class="hint">${e.via.replace(/^(Marítimo|Aéreo)\s?/,'')}</div></td>
         <td class="lnk" style="text-transform:uppercase;font-size:12.5px">${e.prov}</td>
         <td class="r">${e.u?fmtN(e.u):'—'}</td>
         <td class="r">${fmtUSD(e.fob)}</td>
         <td>${e.pol||'<span class="hint">Por confirmar</span>'}</td>
         <td>${dcell(e.zarpe,e.zarpeEst)}</td>
         <td>${e.etaIni?fmtD(e.etaIni):'<span class="hint">—</span>'}</td>
         <td>${eta}</td>
         <td>${dcell(e.bodega,e.bodegaEst)}</td>
         <td class="r">${total!=null?(est?'~':'')+total+' d':'—'}</td>
         <td class="r">${tr!=null?(est?'~':'')+tr+' d':'—'}</td>
         <td><span class="chip plain ${nd===td?'s-ok':nd<=1?'s-quiebre':'s-comprar'}">${nd}/${td}</span></td>
         <td style="white-space:normal;min-width:170px;font-size:12.5px;color:${alertas.length?'var(--warn)':'var(--ink-3)'}">${alertas.join(' · ')||'—'}</td></tr>`}).join(''):`<tr><td colspan="17" style="text-align:center;color:var(--ink-3);padding:28px">Ninguna importación coincide con los filtros.</td></tr>`}
      </tbody></table></div>
     <p class="hint" style="margin:10px 0 0">Tiempo total = orden → fecha en CD. Tránsito = ETD → fecha en CD. "~" = fecha estimada. ETA inicial = primera fecha informada por el forwarder (se carga desde Klog).</p>
    </div>
   </div>
   <div class="grid-2" id="factores">
    <div class="panel"><header><h3>Factores de importación</h3><span class="sub">Todas las importaciones y cotizaciones · pestañas de costeo del Sheets</span></header>${factorTable()}</div>
    <div class="panel"><header><h3>Evolución del factor</h3><div class="seg" id="fm" style="margin-left:auto">${[['linea','Tipo de producto'],['prov','Proveedor']].map(([k,l])=>`<button aria-pressed="${factorModo===k}" data-fm="${k}">${l}</button>`).join('')}</div></header>${factorChart()}</div>
   </div>
   </div></section>`;
}
function bindImp(){
  document.querySelectorAll('tr[data-emb]').forEach(el=>el.onclick=()=>{const e=EMB.find(x=>x.id===el.dataset.emb);e&&e.cot&&!FICHA[e.id]?cotDrawer(e.id):abrirFicha(el.dataset.emb)});
  document.querySelectorAll('[data-fm]').forEach(b=>b.onclick=()=>{factorModo=b.dataset.fm;const y=window.scrollY;render();window.scrollTo(0,y)});
  $('#subir-pi').onclick=()=>{piDestino=null;piDrawer()};
  bindFactorChart();
  document.querySelectorAll('input[data-fk]').forEach(i=>i.onchange=()=>{const set=FIL[i.dataset.fk];i.checked?set.add(i.value):set.delete(i.value);render()});
  const c=$('#clr'); if(c) c.onclick=()=>{Object.values(FIL).forEach(x=>x.clear());render()};
  const setF=v=>{filtrosAbiertos=v;try{localStorage.setItem('pc-fil',v?'1':'0')}catch(e){}render()};
  $('#tgl').onclick=()=>setF(!filtrosAbiertos);
  const oc=$('#ocultar'); if(oc) oc.onclick=()=>setF(false);
  document.querySelectorAll('.kbtn').forEach(b=>b.onclick=()=>{const k=b.dataset.est;
    if(k==='*'||(FIL.estado.size===1&&FIL.estado.has(k))) FIL.estado.clear(); else {FIL.estado.clear();FIL.estado.add(k)}
    render()});
  const q=$('#q'); q.oninput=()=>{qImp=q.value;const pos=q.selectionStart;render();const n=$('#q');n.focus();n.setSelectionRange(pos,pos)};
  $('#nueva').onclick=nuevaFicha;
}

/* ---------- CAJA ---------- */
/* Calendario de pagos: cada importación se descompone en sus salidas reales de dinero, cada una en su fecha.
   Montos CLP desde la pestaña de costeo (REAL si existe, si no PROYECTADO). Fechas: reales cuando se conocen,
   si no se estiman desde pedido / zarpe (ETD) / DIN (arribo) / llegada a CD. */
const CAT={prov:['Proveedor','var(--violet)'],flete:['Flete internacional','var(--cyan)'],imp:['Impuestos de internación','var(--c-imp)'],agencia:['Agencia y gastos portuarios','var(--c-local)'],bodega:['Flete a bodega','var(--c-bod)']};
const CAT_ORD=['prov','flete','imp','agencia','bodega'];
const SPLIT_DEF=50; // % del flete pagado al zarpe si la importación no trae su propia condición (campo splitFlete)
/* Pagos reales por importación. Fuentes: correos de Netnow (solicitudes de pago, Swift, DIN), Swift en carpetas de Drive
   y la pestaña de costeo del Sheets cuando no hay otro respaldo. Formato:
   [fecha, tipo, concepto, moneda, monto, T/C (si es USD y se conoce), fuente, fecha estimada (1)] */
const fmtMonto=(mon,v)=>mon==='USD'?'USD $'+Number(v).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2}):'CLP $'+Math.round(v).toLocaleString('es-CL');
const addD=(s,n)=>{const d=D(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
function fechasEmb(e){
  const aereo=e.tipo==='Aéreo'||/aéreo/i.test(e.via);
  const lt=aereo?30:(P[e.linea]?.lt||110);
  const cd=e.bodega||e.bodegaEst||(e.pedido?addD(e.pedido,lt):null);
  const zarpe=e.zarpe||e.zarpeEst||(cd?addD(cd,aereo?-12:-48):null);
  const din=e.din||e.dinEst||(cd?addD(cd,aereo?-3:-6):null);
  return {aereo,zarpe,din,cd};
}
function pagosEmb(e){
  const out=[];
  const add=(fecha,cat,concepto,mon,monto,tc,fuente,est)=>{ if(!monto||!fecha) return;
    out.push({fecha,cat,concepto,mon,monto,tc:mon==='USD'?(tc||null):null,clp:mon==='USD'?monto*(tc||TC):monto,fuente,emb:e.id,linea:e.linea,est:!!est,estado:fecha<HOY_S?'Pagado':'Proyectado'}) };
  const lista=PAGOS[e.id];
  if(lista){ lista.forEach(p=>add(...p)); return out; }
  if(!e.fob) return out;
  // importación nueva o cotización: calendario estimado con las condiciones de la PI
  const F=fechasEmb(e), a=(e.cot?.anticipo??e.anticipo??30)/100, tc=e.cot?.tc||null, fl=e.cot?.flete??e.flete??0;
  const fBal={produccion:addD(F.zarpe,-10),embarque:addD(F.zarpe,-7),bl:addD(F.zarpe,5),arribo:F.din}[e.balance||'embarque'];
  add(e.pedido,'prov',a<1?`Anticipo ${Math.round(a*100)}% proveedor`:'Pago 100% proveedor','USD',e.fob*a,tc,'Estimado',1);
  if(a<1) add(fBal,'prov',`Balance ${Math.round((1-a)*100)}% proveedor (${(BALANCE[e.balance]||'antes del embarque').toLowerCase()})`,'USD',e.fob*(1-a),tc,'Estimado',1);
  add(F.aereo?F.zarpe:F.din,'flete',F.aereo?'Flete aéreo':'Flete internacional','USD',fl,tc,'Estimado',1);
  add(F.din,'imp','IVA importación 19% estimado','USD',(e.fob+fl)*0.19,tc,'Estimado',1);
  const loc=e.cot?.localesCLP??(F.aereo?729880:1194654);
  add(F.din,'agencia','Agencia y gastos portuarios','CLP',loc*0.7,null,'Estimado',1);
  add(F.cd,'bodega',F.aereo?'Flete aeropuerto → bodega':'Flete puerto → bodega','CLP',loc*0.3,null,'Estimado',1);
  return out;
}
let incluirCot=false, cajaRango='todo', cajaMesSel=null;
function todosPagos(){
  let ps=EMB.filter(e=>e.estado!=='En cotización'||incluirCot).flatMap(e=>{
    if(e.estado==='En cotización'){const x={...e,pedido:HOY_S};return pagosEmb(x).map(p=>({...p,estado:'Cotización'}))}
    return pagosEmb(e)});
  CAJA_COMP.forEach(c=>ps.push({fecha:c.fecha||c.mes+'-15',cat:{prov:'prov',flete:'flete',iva:'imp',local:'agencia'}[c.tipo]||'agencia',concepto:c.txt,clp:c.clp||c.usd*TC,mon:c.usd?'USD':'CLP',monto:c.usd||c.clp,tc:null,fuente:'Registro manual',emb:c.emb,est:false,estado:(c.fecha||c.mes+'-15')<HOY_S?'Pagado':'Proyectado',manual:true}));
  return ps.sort((a,b)=>a.fecha<b.fecha?-1:1);
}
function mesesRango(){
  const ini=cajaRango==='futuro'?'2026-10':cajaRango==='12m'?'2025-10':'2025-03';
  const fin=cajaRango==='12m'?'2026-09':'2027-02';
  const out=[];let [y,m]=ini.split('-').map(Number);
  while(`${y}-${String(m).padStart(2,'0')}`<=fin){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m>12){m=1;y++}}
  return out;
}
const mesLbl=(k,o={month:'short',year:'2-digit'})=>D(k+'-01').toLocaleDateString('es-CL',o).replace('.','');
let CAJA_HOV=null;
function caja(){
  const ps=todosPagos(), meses=mesesRango(), mesHoy=HOY_S.slice(0,7);
  const M={};meses.forEach(k=>{M[k]={};CAT_ORD.forEach(c=>M[k][c]={pag:0,pro:0,items:[]})});
  ps.forEach(p=>{const k=p.fecha.slice(0,7);if(!M[k])return;const b=M[k][p.cat];(p.estado==='Pagado'?b.pag+=p.clp:b.pro+=p.clp);b.items.push(p)});
  const tot=k=>CAT_ORD.reduce((s,c)=>s+M[k][c].pag+M[k][c].pro,0);
  const rawMax=Math.max(...meses.map(tot),1);
  const step=[2e6,5e6,10e6,20e6,25e6,50e6].find(s=>rawMax/s<=5)||1e8, max=Math.ceil(rawMax/step)*step;
  const W=Math.max(720,meses.length*44+80),H=300,pl=62,pb=30,pt=22,bw=(W-pl-10)/meses.length;
  const Y=v=>H-pb-(v/max)*(H-pb-pt);
  CAJA_HOV={M,tot};
  let g='';
  for(let t=0;t<=max+1;t+=step) g+=`<line x1="${pl}" x2="${W-10}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${pl-8}" y="${Y(t)+4}" font-size="11" text-anchor="end">${t?(t/1e6).toFixed(0)+' MM':'0'}</text>`;
  const iHoy=meses.indexOf(mesHoy);
  if(iHoy>=0){const xh=pl+iHoy*bw+bw*(6/31);g+=`<line x1="${xh}" x2="${xh}" y1="${pt-8}" y2="${H-pb}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${xh+4}" y="${pt-10}" font-size="10.5" style="fill:var(--bad);font-weight:600">Hoy · proyectado →</text>`}
  meses.forEach((k,i)=>{
    let y=H-pb;const x=pl+i*bw+bw*.18,w=bw*.64;
    CAT_ORD.forEach(c=>{const b=M[k][c];
      [['pag',1],['pro',0]].forEach(([s,sol])=>{const v=b[s];if(!v)return;const h=v/max*(H-pb-pt);y-=h;
        g+=`<rect class="cseg" tabindex="0" data-mes="${k}" data-cat="${c}" x="${x}" y="${y}" width="${w}" height="${Math.max(h,1)}" fill="${sol?CAT[c][1]:'url(#hatch-'+c+')'}" ${sol?'':`stroke="${CAT[c][1]}" stroke-width="1"`} aria-label="${CAT[c][0]} ${mesLbl(k,{month:'long'})}: ${fmtCLP(v)}"></rect>`;});
    });
    const t=tot(k);
    g+=`<text x="${x+w/2}" y="${H-10}" font-size="10.5" text-anchor="middle" style="${k===cajaMesSel?'fill:var(--violet);font-weight:700':''}">${mesLbl(k).replace(' ','\n')}</text>`;
    if(t) g+=`<text x="${x+w/2}" y="${y-5}" font-size="10" text-anchor="middle" style="fill:var(--ink)">${(t/1e6).toFixed(1).replace('.',',')}</text>`;
    g+=`<rect class="cmes" data-mes="${k}" x="${pl+i*bw}" y="${H-pb+2}" width="${bw}" height="${pb-2}" fill="transparent" style="cursor:pointer"></rect>`;
  });
  const defs=`<defs>${CAT_ORD.map(c=>`<pattern id="hatch-${c}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${CAT[c][1]}" opacity=".22"/><line x1="0" y1="0" x2="0" y2="6" stroke="${CAT[c][1]}" stroke-width="2.4"/></pattern>`).join('')}</defs>`;
  const svg=`<div class="fchart" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:none;height:auto;display:block;min-width:100%" aria-label="Pagos por mes">${defs}${g}</svg><div class="ftt" id="ctt" hidden></div></div>`;
  // KPIs
  const fut=ps.filter(p=>p.estado!=='Pagado'), pag12=ps.filter(p=>p.estado==='Pagado'&&p.fecha>=addD(HOY_S,-365));
  const prox90=fut.filter(p=>p.fecha<=addD(HOY_S,90));
  const sum=a=>a.reduce((s,p)=>s+p.clp,0);
  const futM={};fut.forEach(p=>{const k=p.fecha.slice(0,7);futM[k]=(futM[k]||0)+p.clp});
  const pico=Object.entries(futM).sort((a,b)=>b[1]-a[1])[0];
  const tabla=ps.filter(p=>cajaMesSel?p.fecha.startsWith(cajaMesSel):(p.fecha>=addD(HOY_S,-60))).filter(p=>meses.includes(p.fecha.slice(0,7))||cajaMesSel);
  return `<section class="view">
   <div class="head"><div><h2 style="font-size:22px;margin-top:4px">Flujo de caja de compras</h2>
     <p>Cada pago en su fecha: anticipo y saldo al proveedor, flete internacional (anticipo al zarpe y saldo al arribo), impuestos de internación al aceptar la DIN, agencia y gastos portuarios, y el flete a bodega. Lo pagado va en color sólido; lo proyectado, achurado.</p></div>
     <div class="actions">
      <div class="seg" id="rng">${[['todo','Mar-25 → feb-27'],['12m','Últimos 12 meses'],['futuro','Próximos meses']].map(([k,l])=>`<button aria-pressed="${cajaRango===k}" data-r="${k}">${l}</button>`).join('')}</div>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500"><input type="checkbox" id="inc" ${incluirCot?'checked':''} style="width:auto"> Incluir cotizaciones</label>
</div></div>
   <div class="kpis">
    <div class="kpi"><span class="eyebrow">Pagado últimos 12 meses</span><span class="v num">${fmtCLP(sum(pag12))}</span><span class="d">${pag12.length} pagos</span></div>
    <div class="kpi"><span class="eyebrow">Por pagar próximos 90 días</span><span class="v num">${fmtCLP(sum(prox90))}</span><span class="d">Hasta ${fmtD(addD(HOY_S,90))} · ${prox90.length} pagos</span></div>
    <div class="kpi"><span class="eyebrow">De eso, IVA recuperable</span><span class="v num">${fmtCLP(sum(prox90.filter(p=>p.cat==='imp')))}</span><span class="d">Vuelve como crédito fiscal</span></div>
    <div class="kpi"><span class="eyebrow">Mes de mayor salida proyectada</span><span class="v num" style="text-transform:capitalize">${pico?mesLbl(pico[0],{month:'long'}):'—'}</span><span class="d">${pico?fmtCLP(pico[1]):''}</span></div>
   </div>
   <div class="panel"><header><h3>Salidas por mes (CLP millones)</h3><span class="sub">Pasa el mouse por cada tramo · clic en el mes para ver sus pagos</span>
     <div class="legend" style="margin-left:auto">${CAT_ORD.map(c=>`<span><i style="background:${CAT[c][1]}"></i>${CAT[c][0]}</span>`).join('')}<span><i style="background:repeating-linear-gradient(45deg,var(--ink-3) 0 2px,transparent 2px 4px)"></i>Proyectado</span></div></header>${svg}</div>
   <div class="panel"><header><h3>${cajaMesSel?'Pagos de '+mesLbl(cajaMesSel,{month:'long',year:'numeric'}):'Calendario de pagos'}</h3><span class="sub">${cajaMesSel?'<button class="lnk" id="todos" style="background:none;border:0;cursor:pointer">Ver todos</button>':'Desde hace 60 días en adelante · clic en un mes del gráfico para filtrar'}</span></header>
    <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Importación</th><th>Tipo</th><th>Concepto</th><th class="r">Monto original</th><th class="r">T/C</th><th class="r">CLP</th><th>Fuente</th><th>Estado</th></tr></thead><tbody>
     ${tabla.length?tabla.map(p=>`<tr><td>${fmtD(p.fecha)}${p.est?'<div class="hint">estimada</div>':''}</td><td><b>${p.emb}</b></td><td><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:2px;background:${CAT[p.cat][1]};display:inline-block"></i>${CAT[p.cat][0]}</span></td><td style="white-space:normal;min-width:240px;color:var(--ink-2)">${p.concepto}</td><td class="r">${fmtMonto(p.mon,p.monto)}</td><td class="r hint">${p.mon==='USD'?(p.tc?fmtN(p.tc,2):'por confirmar'):'—'}</td><td class="r">${fmtCLP(p.clp)}</td><td class="hint">${p.fuente||''}</td><td><span class="chip ${p.estado==='Pagado'?'s-ok':p.estado==='Cotización'?'s-sobre':'s-planificar'}">${p.estado}</span></td></tr>`).join(''):'<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:24px">Sin pagos en este período.</td></tr>'}
    </tbody></table></div>
    <p class="hint" style="margin:10px 0 0">Montos desde la pestaña de costeo de cada importación (real si existe, si no proyectado). Pagos tomados de los correos de Netnow (solicitudes de pago, Swift y DIN), de los Swift en las carpetas de Drive y, cuando no hay otro respaldo, de la pestaña de costeo del Sheets. Las fechas sin respaldo se marcan como estimadas. Los USD sin T/C conocido se valorizan a ${fmtN(TC)} hasta registrar el pago.</p></div>
  </section>`;
}
function bindCaja(){
  document.querySelectorAll('#rng button').forEach(b=>b.onclick=()=>{cajaRango=b.dataset.r;render()});
  $('#inc').onchange=e=>{incluirCot=e.target.checked;render()};
  const td=$('#todos'); if(td) td.onclick=()=>{cajaMesSel=null;render()};
  document.querySelectorAll('.cmes,.cseg').forEach(el=>el.addEventListener('click',()=>{cajaMesSel=el.dataset.mes===cajaMesSel?null:el.dataset.mes;const y=window.scrollY;render();window.scrollTo(0,y)}));
  const tt=$('#ctt'); if(!tt) return; const box=tt.parentElement;
  const show=el=>{
    const {M,tot}=CAJA_HOV,k=el.dataset.mes,c=el.dataset.cat,b=M[k][c];
    document.querySelectorAll('.cseg.on').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll(`.cseg[data-mes="${k}"][data-cat="${c}"]`).forEach(x=>x.classList.add('on'));
    tt.innerHTML=`<div style="display:flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:3px;background:${CAT[c][1]};display:inline-block"></i><b>${CAT[c][0]}</b><span class="hint" style="margin-left:auto;text-transform:capitalize">${mesLbl(k,{month:'long',year:'numeric'})}</span></div>
      <div class="ftt-row" style="font-size:14px"><span>Total</span><b>${fmtCLP(b.pag+b.pro)}</b></div>
      ${b.pag&&b.pro?`<div class="ftt-row"><span>Pagado / proyectado</span><b>${fmtCLP(b.pag)} / ${fmtCLP(b.pro)}</b></div>`:`<div class="ftt-row"><span>Estado</span><b>${b.pag?'Pagado':'Proyectado'}</b></div>`}
      <div style="border-top:1px solid var(--line);margin-top:4px;padding-top:5px;display:grid;gap:5px">${b.items.map(i=>`<div style="display:grid;gap:1px"><div class="ftt-row"><span style="color:var(--ink)"><b>${i.emb}</b> · ${fmtD(i.fecha)}${i.est?'*':''}</span><b>${fmtCLP(i.clp)}</b></div><span class="hint">${i.concepto} · ${fmtMonto(i.mon,i.monto)}</span></div>`).join('')}</div>
      <div class="ftt-row" style="border-top:1px solid var(--line);margin-top:4px;padding-top:5px"><span>Total del mes</span><b>${fmtCLP(tot(k))}</b></div>
      ${b.items.some(i=>i.est)?'<div class="hint">* fecha estimada</div>':''}`;
    tt.hidden=false;
    const bb=box.getBoundingClientRect(),r=el.getBoundingClientRect(),w=tt.offsetWidth,h=tt.offsetHeight;
    let left=r.right-bb.left+box.scrollLeft+10; if(left+w>box.scrollLeft+bb.width) left=r.left-bb.left+box.scrollLeft-w-10; left=Math.max(box.scrollLeft,left);
    let top=r.top-bb.top+r.height/2-h/2; top=Math.max(0,Math.min(top,bb.height-h));
    tt.style.left=left+'px'; tt.style.top=top+'px';
  };
  const hide=()=>{tt.hidden=true;document.querySelectorAll('.cseg.on').forEach(x=>x.classList.remove('on'))};
  document.querySelectorAll('.cseg').forEach(el=>{el.addEventListener('mouseenter',()=>show(el));el.addEventListener('focus',()=>show(el));el.addEventListener('mouseleave',hide);el.addEventListener('blur',hide)});
}

/* ---------- CARGA DE DATOS ---------- */
let formSel='imp';
function carga(){
  const F={imp:'Nueva importación',hito:'Registrar hito',pago:'Registrar pago',sup:'Supuestos'};
  return `<section class="view">
   <div class="head"><div><h2 style="font-size:22px;margin-top:4px">Carga de datos</h2>
    <p>Todo lo que se registra aquí queda en el Sheets (pestañas BD_*), con quién y cuándo lo cambió. Los documentos se suben a la carpeta de Drive de cada importación.</p></div></div>
   <div class="grid-3-1">
    <div class="panel"><div class="seg" id="fs" style="margin-bottom:14px">${Object.entries(F).map(([k,l])=>`<button aria-pressed="${k===formSel}" data-f="${k}">${l}</button>`).join('')}</div>
      ${({imp:fImp,hito:fHito,pago:fPago,sup:fSup})[formSel]()}</div>
    <div style="display:grid;gap:18px;align-content:start">
     <div class="panel"><header><h3>Fuentes</h3></header>
      <div class="src"><span class="ic">GS</span><div><b>IMPORTACIONES 2EBOX (Sheets)</b><small>Pestañas BD_*: lo que se edita aquí queda ahí, y lo que cambias ahí se ve aquí al actualizar</small></div><span class="chip s-ok">${EMB.length} importaciones</span></div>
      <div class="src"><span class="ic">DR</span><div><b>Carpetas de importación (Drive)</b><small>El motor revisa PI, invoice, packing list, BL, DIN, Swift y set de Grace cada 15 min</small></div><span class="chip ${faltanSets().length?'s-comprar':'s-ok'}">${faltanSets().length} sin set</span></div>
      <div class="src"><span class="ic">@</span><div><b>Gmail (órdenes, pagos, DIN)</b><small>El motor guarda los adjuntos en la carpeta de cada importación</small></div><span class="chip ${CORREOS.some(c=>c.estado==='por asignar')?'s-comprar':'s-ok'}">${CORREOS.filter(c=>c.estado==='por asignar').length} por asignar</span></div>
      <div class="src"><span class="ic">DF</span><div><b>Defontana · 2EBOX SPA</b><small>Stock y ventas por SKU (pestaña BD_Stock)</small></div><span class="chip s-ok">${CFG.stock_fecha?fmtD(CFG.stock_fecha):'—'}</span></div>
     </div>
     <div class="panel"><header><h3>Pendientes de validación</h3></header><div class="alerts" style="font-size:12.5px">
      ${pendientesValidacion().map(t=>`<div class="note">${t}</div>`).join('')||'<div class="note">Sin pendientes.</div>'}
     </div></div>
    </div>
   </div>
   <div class="panel"><header><h3>Cómo queda guardado</h3><span class="sub">Pestañas BD_* del Sheets IMPORTACIONES 2EBOX</span></header>
    <div class="schema">${Object.entries(SCHEMA).map(([t,c])=>`${t.padEnd(17)} ${c.join(' · ')}`).join('\n')}</div></div>
  </section>`;
}
function fImp(){
  return `<div style="display:grid;gap:12px">
   <p style="margin:0;color:var(--ink-2)">La importación se crea en su ficha: parte desde una importación pasada, agrega el mix de productos (o súbelo desde la PI), define incoterm, forma de pago y tipos de cambio, ajusta los gastos y revisa el costeo proyectado y la proyección de ventas por portal.</p>
   <ol style="margin:0;padding-left:18px;color:var(--ink-2);display:grid;gap:4px;font-size:13px"><li>Datos e importación base</li><li>Mix de productos</li><li>Forma de pago</li><li>Tipo de cambio</li><li>Costeo proyectado y real</li><li>Costeo por producto</li><li>Ventas por portal</li></ol>
   <div><button class="btn primary" type="button" id="carga-nueva">Abrir ficha de nueva importación</button></div></div>`;
}
function fHito(){
  const act=EMB.filter(e=>e.estado!=='Recibido'||!e.din);
  return `<form id="f-hito" novalidate><div class="fields">
   <label>Importación<select id="h-emb">${act.map(e=>`<option>${e.id}</option>`).join('')}</select></label>
   <label>Hito<select id="h-tipo"><option value="zarpe">Zarpe (BL)</option><option value="din" selected>DIN aceptada</option><option value="bodega">Llegada a bodega</option></select></label>
   <label>Fecha<input type="date" id="h-fecha" value="${HOY_S}"></label>
   <label>N° documento<input id="h-doc" class="mono" placeholder="1930000000-0"><span class="hint">DIN: 10 dígitos y dígito verificador</span></label>
   <label>T/C aduanero<input id="h-tc" type="number" step="0.01" placeholder="940,21"></label>
   <label>IVA pagado (USD)<input id="h-iva" type="number" step="0.01" placeholder="9216"></label>
  </div><div style="display:flex;gap:10px"><span class="hint">Adjunta el PDF en la carpeta de Drive; el sistema detecta el archivo "DIN ….pdf".</span><button class="btn primary" style="margin-left:auto" type="submit">Registrar hito</button></div>
  <div class="err" id="h-err" hidden></div></form>`;
}
function fPago(){
  return `<form id="f-pago" novalidate><div class="fields">
   <label>Importación<select id="p-emb">${EMB.map(e=>`<option>${e.id}</option>`).join('')}</select></label>
   <label>Tipo<select id="p-tipo"><option>Anticipo</option><option selected>Saldo</option><option>Flete</option><option>IVA importación</option><option>Gastos locales</option></select></label>
   <label>Moneda<select id="p-mon"><option>USD</option><option>CLP</option></select></label>
   <label>Monto<input id="p-monto" type="number" step="0.01"></label>
   <label>T/C del pago<input id="p-tc" type="number" step="0.01" value="${TC}"><span class="hint">Obligatorio en USD: el costeo usa el T/C real pagado</span></label>
   <label>Fecha<input id="p-fecha" type="date" value="${HOY_S}"></label>
   <label>Estado<select id="p-est"><option>Pagado</option><option>Programado</option></select></label>
   <label>Reemplaza a<select id="p-ref"></select><span class="hint">Si el pago ya estaba proyectado, elígelo para que quede con monto, fecha y T/C reales</span></label>
   <label>Detalle<input id="p-txt" placeholder="Swift, factura, N° de operación"></label>
   <label>Respaldo (link)<input id="p-resp" placeholder="https://drive.google.com/…"></label>
  </div><div style="display:flex;gap:10px"><span class="hint">Adjunta el Swift o comprobante en la carpeta de la importación.</span><button class="btn primary" style="margin-left:auto" type="submit">Registrar pago</button></div>
  <div class="err" id="p-err" hidden></div></form>`;
}
function fSup(){
  return `<form id="f-sup" novalidate><div class="tbl-wrap"><table><thead><tr><th>Línea</th><th class="r">Lead time (d)</th><th class="r">Seguridad (d)</th><th class="r">Revisión (d)</th><th class="r">MOQ</th><th class="r">Margen NN %</th><th class="r">Factor import.</th><th class="r">Índice estacional</th></tr></thead><tbody>
   ${Object.entries(P).map(([l,p])=>`<tr><td><b>${l}</b></td>${['lt','ss','rev','moq','margen','factor','est'].map(k=>`<td><input data-l="${l}" data-k="${k}" type="number" step="any" value="${p[k]}" style="text-align:right;width:86px"></td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  <p class="hint" style="margin:0">Índice estacional multiplica la demanda proyectada (ej. 1,4 para chimeneas antes del invierno). Lead time sale de la mediana real pedido → bodega; Reolink usa vía aérea.</p>
  <div style="display:flex"><button class="btn primary" style="margin-left:auto" type="submit">Aplicar y recalcular</button></div></form>`;
}
function bindCarga(){
  document.querySelectorAll('#fs button').forEach(b=>b.onclick=()=>{formSel=b.dataset.f;render()});
  const cp=$('#carga-pi'); if(cp) cp.onclick=()=>{piDestino=null;piDrawer()};
  const cn=$('#carga-nueva'); if(cn) cn.onclick=nuevaFicha;
  const fi=$('#f-imp');
  if(fi){
    const upd=()=>{let t=0;fi.querySelectorAll('#i-lines tr').forEach(tr=>{const [s,u,f]=tr.querySelectorAll('input');const st=(+u.value||0)*(+f.value||0);t+=st;tr.lastElementChild.textContent=fmtUSD(st)});
      $('#i-tot').textContent=fmtUSD(t);const c=$('#i-cond').value;const a=c.startsWith('20')?.2:c.startsWith('30')?.3:1;
      $('#i-cuotas').textContent=a<1?`Anticipo ${fmtUSD(t*a)} hoy · saldo ${fmtUSD(t*(1-a))} antes del embarque`:'Pago total al pedido';return t};
    fi.oninput=upd;upd();
    fi.onsubmit=ev=>{ev.preventDefault();const t=upd();const id=$('#i-num').value.trim();const err=$('#i-err');
      if(!id||EMB.some(e=>e.id===id)){err.hidden=false;err.textContent=id?'Ya existe una importación con ese número. Usa el nombre de la carpeta nueva.':'Falta el número de importación.';return}
      if(t<=0){err.hidden=false;err.textContent='Agrega al menos una línea con unidades y FOB.';return}
      const c=$('#i-cond').value;const a=c.startsWith('20')?.2:c.startsWith('30')?.3:1;
      EMB.push({id,linea:$('#i-linea').value,prov:$('#i-prov').value,via:$('#i-via').value,u:[...fi.querySelectorAll('#i-lines tr')].reduce((s,tr)=>s+(+tr.querySelectorAll('input')[1].value||0),0),estado:'En producción',pedido:$('#i-fecha').value,fob:t,pagos:[['Anticipo',t*a,null,$('#i-fecha').value]],docs:{PI:0,Invoice:0,'Packing list':0,BL:0,DIN:0,Swift:0,'Set importación':0}});
      toast(`${id} creada en esta vista. El mockup no guarda los cambios.`);cur='importaciones';render()};
  }
  const fh=$('#f-hito');
  if(fh) fh.onsubmit=ev=>{ev.preventDefault();const tipo=$('#h-tipo').value,doc=$('#h-doc').value.trim(),err=$('#h-err');
    if(tipo==='din'&&!/^\d{10}-[\dkK]$/.test(doc)){err.hidden=false;err.textContent='El N° de DIN debe tener 10 dígitos, guion y dígito verificador (ej. 1930476517-0).';return}
    if(tipo==='din'&&!$('#h-tc').value){err.hidden=false;err.textContent='Ingresa el T/C aduanero que aparece en la DIN.';return}
    const e=EMB.find(x=>x.id===$('#h-emb').value);e[tipo]=$('#h-fecha').value;
    if(tipo==='zarpe'&&e.estado==='En producción')e.estado='En tránsito';
    if(tipo==='din'){e.dinN=doc;const tc=+$('#h-tc').value;const iva=+$('#h-iva').value;if(iva)e.iva=iva;const f=fichaDe(e.id);if(f&&tc){f.tcAduana=tc}
      if(f&&iva&&tc){f.real.ivaClp=Math.round(iva*tc)}}
    if(tipo==='bodega')e.estado='Recibido';
    guardar(e.id,'Hito '+tipo);toast(`Hito registrado en ${e.id}.`);cur='importaciones';render()};
  const fp=$('#f-pago');
  if(fp) fp.onsubmit=ev=>{ev.preventDefault();const err=$('#p-err');
    if($('#p-mon').value==='USD'&&!$('#p-tc').value){err.hidden=false;err.textContent='Los pagos en USD necesitan T/C para costear.';return}
    const tipoMap={Anticipo:'prov',Saldo:'prov',Flete:'flete','IVA importación':'imp','Gastos locales':'agencia'};
    const m=+$('#p-monto').value; if(!m){err.hidden=false;err.textContent='Ingresa el monto.';return}
    const id=$('#p-emb').value, e=EMB.find(x=>x.id===id); materializarPagos(e,false);
    const lista=PAGOS[id], ref=$('#p-ref').value, pagado=$('#p-est').value==='Pagado';
    const fila=[$('#p-fecha').value,tipoMap[$('#p-tipo').value],`${$('#p-tipo').value}${$('#p-txt').value?' · '+$('#p-txt').value:''}`,$('#p-mon').value,m,$('#p-mon').value==='USD'?(+$('#p-tc').value||null):null,'Registro manual',pagado?0:1,null,$('#p-resp').value||''];
    if(ref!=='nuevo'){const i=+ref;fila[8]=lista[i][8];lista[i]=fila}else lista.push(fila);
    lista.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    guardar(id,'Registrar pago');toast('Pago registrado en el flujo de caja.');cur='caja';render()};
  const pe=$('#p-emb'); if(pe){const llenar=()=>{const e=EMB.find(x=>x.id===pe.value);if(e&&EDITOR)materializarPagos(e,false);const ps=(e&&PAGOS[e.id])||[];
      $('#p-ref').innerHTML='<option value="nuevo">Pago nuevo</option>'+ps.map((p,i)=>p[7]||p[0]>=HOY_S?`<option value="${i}">${fmtD(p[0])} · ${p[2]} · ${fmtMonto(p[3],p[4])}</option>`:'').join('')};
    pe.onchange=llenar;llenar();}
  const fs=$('#f-sup');
  if(fs) fs.onsubmit=async ev=>{ev.preventDefault();fs.querySelectorAll('input[data-l]').forEach(i=>{P[i.dataset.l][i.dataset.k]=+i.value});
    try{estadoGuardado('guardando');await Store.guardarConfig({supuestos_json:JSON.stringify(P)});estadoGuardado('ok');toast('Supuestos guardados. Plan recalculado.')}catch(err){estadoGuardado('error',err.message)}cur='reposicion';render()};
}

/* ---------- DRAWERS ---------- */
function closeDrawer(){$('#drawer-root').innerHTML=''}
function openDrawer(html){
  $('#drawer-root').innerHTML=`<div class="drawer-bg"></div><aside class="drawer" role="dialog" aria-modal="true"><button class="btn x" aria-label="Cerrar">Cerrar</button>${html}</aside>`;
  $('#drawer-root .drawer-bg').onclick=closeDrawer;$('#drawer-root .x').onclick=closeDrawer;
  $('#drawer-root .x').focus();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
function skuDrawer(sku){
  const r=calc(SKUS.find(s=>s.sku===sku));
  const W=500,H=170,pl=30,pb=24,bw=(W-pl)/12;const max=Math.max(...(r.ventas||[1]),r.prom,1);
  const chart=r.ventas?`<svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto">
    ${[0,.5,1].map(t=>{const y=H-pb-t*(H-pb-10);return `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl-6}" y="${y+4}" font-size="10.5" text-anchor="end">${Math.round(t*max)}</text>`}).join('')}
    ${r.ventas.map((v,i)=>{const h=v/max*(H-pb-10);return `<rect x="${pl+i*bw+3}" y="${H-pb-h}" width="${bw-6}" height="${Math.max(h,0)}" rx="2" fill="var(--violet)"></rect>${v===0?`<text x="${pl+i*bw+bw/2}" y="${H-pb-4}" font-size="9.5" text-anchor="middle" style="fill:var(--bad)">0</text>`:''}<text x="${pl+i*bw+bw/2}" y="${H-6}" font-size="10" text-anchor="middle">${MESES[i].slice(0,3)}</text>`}).join('')}
    ${r.prom?`<line x1="${pl}" x2="${W}" y1="${H-pb-r.prom/max*(H-pb-10)}" y2="${H-pb-r.prom/max*(H-pb-10)}" stroke="var(--cyan)" stroke-width="2" stroke-dasharray="5 4"/><text x="${W-4}" y="${H-pb-r.prom/max*(H-pb-10)-5}" font-size="10.5" text-anchor="end" style="fill:var(--ink)">promedio ${fmtN(r.prom,1)}/mes</text>`:''}
  </svg>`:'<div class="note">Producto nuevo. Sin ventas aún; el plan parte cuando se registren las primeras.</div>';
  openDrawer(`<div><span class="eyebrow">${r.linea} · ${r.p.prov}</span><h2 style="font-size:20px;margin-top:4px">${r.nombre}</h2><div class="mono" style="color:var(--ink-3)">${r.sku}</div></div>
   <div>${chip(r.estado)}</div><p style="margin:0;color:var(--ink-2)">${accion(r)}</p>
   <div class="kv">
    <div><span>Stock</span><b>${fmtN(r.stock)} u</b></div><div><span>En camino</span><b>${r.transito?fmtN(r.transito)+' u · '+fmtD(r.eta):'—'}</b></div>
    <div><span>Venta / mes</span><b>${fmtN(r.prom,1)}</b></div><div><span>Cobertura</span><b>${isFinite(r.cob)?fmtN(r.cob)+' días':'—'}</b></div>
    <div><span>Stock seguridad</span><b>${fmtN(r.ss)} u</b></div><div><span>Punto de reorden</span><b>${fmtN(r.rop)} u</b></div>
    <div><span>Sugerido</span><b>${r.sug?fmtN(r.sug)+' u':'—'}</b></div><div><span>Pedir antes de</span><b>${r.pedirAntes&&r.estado!=='sobre'?r.pedirAntes.toLocaleDateString('es-CL'):'—'}</b></div>
   </div>
   <div class="panel" style="padding:12px"><h3 style="margin-bottom:6px">Ventas últimos 12 meses</h3>${chart}<p class="hint" style="margin:4px 0 0">Meses en 0 se tratan como quiebre y no entran al promedio.</p></div>
   <div class="kv">
    <div><span>FOB último</span><b>${r.fob?'US$ '+r.fob:'—'}</b></div><div><span>Costo Netnow</span><b>${fmtCLP(r.costoNN)}</b></div><div><span>Costo 2ebox (+${r.p.margen}%)</span><b>${fmtCLP(r.costo2e)}</b></div>
    ${r.sug&&r.fob?`<div><span>Compra sugerida</span><b>${fmtUSD(r.sug*r.fob)} FOB</b></div>`:''}
   </div>`);
}
function embDrawer(id){
  const e=EMB.find(x=>x.id===id);
  const step=(lbl,real,est,extra='')=>`<div class="step ${real?'done':est?'est':''}"><span class="dot"></span><div><b>${lbl}</b>${extra?`<div><small>${extra}</small></div>`:''}</div><span class="num">${real?fmtD(real):est?'~'+fmtD(est):'—'}</span></div>`;
  const ps=pagosEmb(e), tPag=ps.reduce((a,p)=>a+p.clp,0), dl=DOCS[e.id]||[];
  openDrawer(`<div><span class="eyebrow">${e.linea} · ${e.prov} · ${e.via}</span><h2 style="font-size:20px;margin-top:4px">${e.id} <span class="mono lnk" style="font-size:14px">${e.ref||''}</span></h2>
    ${e.klog?`<div class="hint">Ref. embarcador (Klog): <span class="mono">${e.klog}</span>${e.cdFuente?' · '+e.cdFuente:''}</div>`:''}
    <div class="hint">Carpeta Drive: ${e.carpetaId?`<a href="https://drive.google.com/drive/folders/${e.carpetaId}" target="_blank" rel="noopener">${e.carpeta||'abrir'}</a>`:(e.carpeta||'—')} · Pestaña Sheets: ${e.pest||'<b style="color:var(--bad)">sin pestaña</b>'}</div>
    ${e.actualizadoPor?`<div class="hint">Última edición: ${e.actualizadoPor}${e.actualizado?' · '+new Date(e.actualizado).toLocaleString('es-CL'):''}</div>`:''}</div>
   ${e.alerta?`<div class="note" style="color:var(--warn)">${e.alerta}</div>`:''}
   <div class="kv"><div><span>Unidades</span><b>${e.u?fmtN(e.u):'—'}</b></div><div><span>FOB</span><b>${fmtUSD(e.fob)}</b></div><div><span>Flete</span><b>${fmtUSD(e.flete)}</b></div><div><span>Factor real</span><b>${e.factor?String(e.factor).replace('.',','):'pendiente'}</b></div><div><span>T/C costeo</span><b>${e.tc?fmtN(e.tc,2):'—'}</b></div>${e.iva?`<div><span>IVA importación</span><b>${fmtUSD(e.iva)}</b></div>`:''}</div>
   <div class="panel" style="padding:12px 14px"><h3 style="margin-bottom:4px">Hitos</h3><div class="steps">
    ${step('Pedido / anticipo',e.pedido)}
    ${step('Zarpe',e.zarpe,e.zarpeEst,e.zarpe&&e.pedido?diff(e.pedido,e.zarpe)+' días de producción':'')}
    ${step('DIN aceptada',e.din,e.dinEst,e.dinN?'N° '+e.dinN+(e.zarpe&&e.din?' · '+diff(e.zarpe,e.din)+' días de tránsito':''):'')}
    ${step('Llegada a bodega',e.bodega,e.bodegaEst,(e.bodega||e.bodegaEst)?diff(e.pedido,e.bodega||e.bodegaEst)+' días desde el pedido':'')}
   </div></div>
   <div class="panel" style="padding:12px 14px"><h3 style="margin-bottom:6px">Pagos</h3><div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th class="r">Monto</th><th class="r">T/C</th><th class="r">CLP</th><th>Fuente</th></tr></thead><tbody>
    ${ps.map(p=>`<tr><td>${p.est?'~':''}${fmtD(p.fecha)}</td><td>${p.concepto}</td><td class="r">${fmtMonto(p.mon,p.monto)}</td><td class="r">${p.mon==='USD'?(p.tc?fmtN(p.tc,2):'—'):''}</td><td class="r">${fmtCLP(p.clp)}</td><td class="hint">${p.fuente||''}</td></tr>`).join('')}
    <tr class="tot"><td></td><td><b>Total</b></td><td></td><td></td><td class="r"><b>${fmtCLP(tPag)}</b></td><td></td></tr></tbody></table></div></div>
   <div><h3 style="margin-bottom:8px">Documentos en la carpeta</h3><div class="docs">${Object.entries(e.docs).map(([k,v])=>{const d=dl.find(x=>x.tipo===k&&x.url);return d?`<a class="doc y" href="${d.url}" target="_blank" rel="noopener">✓ ${k}</a>`:`<span class="doc ${v?'y':'n'}">${v?'✓':'✗'} ${k}</span>`}).join('')}</div>
    ${dl.filter(d=>d.url).length?`<div class="hint" style="margin-top:8px">${dl.filter(d=>d.url).map(d=>`<a href="${d.url}" target="_blank" rel="noopener">${d.archivo}</a>`).join(' · ')}</div>`:''}</div>
   ${CORREOS.filter(c=>c.importacion===e.id).length?`<div><h3 style="margin-bottom:8px">Correos</h3>${CORREOS.filter(c=>c.importacion===e.id).slice(0,8).map(c=>`<div class="hint"><a href="${c.link}" target="_blank" rel="noopener">${fmtD(c.fecha)} · ${c.asunto}</a> <span class="chip">${c.tipo}</span></div>`).join('')}</div>`:''}`);
}

/* ---------- COTIZACIONES, LECTOR DE PI Y FACTORES ---------- */
/* Modelo del proveedor → SKU interno */
const MODELO_SKU = {
  'WCE1PT2K04':'ACC-0074','WCEP5MP05PT':'ACC-0075','WCEP5MP04PTW':'ACC-0076','WCTMXPT4K05':'ACC-0077','VDB2K02W':'ACC-0078',
  'HH0164':'ACC-0079','BWB2K07':'ACC-0080','BWC2K02':'ACC-0081','BWC4K01':'ACC-0082','BWPT4K04':'ACC-0083','SP2-W':'ACC-0084',
  'IF-40FSB-TS':'IF-40FSB-TS','IF-50FSB-TS':'IF-50FSB-TS','IF-60FSB-TS':'IF-60FSB-TS',
  'ND-189':'ND-189','ND-189B':'ND-189B','ND-189B-TW':'ND-189B-TW',
  'MANUAL SCREEN WITH SELF LOCK 60':'ACC-0088','MANUAL SCREEN WITH SELF LOCK 100':'ACC-0089',
  'TRIPOD SCREEN WITH STAND 100':'ACC-0090','ELECTRIC SCREEN WITH REMOTE CONTROL 100':'ACC-0091'
};
const PVP_REF = {'ACC-0074':29990,'ACC-0075':37990,'ACC-0076':29990,'ACC-0077':189990,'ACC-0078':99990,'ACC-0079':119990,'ACC-0080':79990,'ACC-0081':109990,'ACC-0082':129990,'ACC-0083':129990,'ACC-0084':25990,
  'ACC-0088':59990,'ACC-0089':79990,'ACC-0090':69990,'ACC-0091':69990,'IF-40FSB-TS':299990,'IF-50FSB-TS':349990,'IF-60FSB-TS':399990};

function piNum(v){
  if(typeof v==='number') return v;
  if(v==null) return NaN;
  const t=String(v).replace(/usd|us\$|\$|pcs|pc|\s/gi,'').replace(/,(?=\d{3}\b)/g,'');
  if(!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return parseFloat(t);
}
function parsePI(aoa, fuente){
  const rows=aoa.map(r=>(r||[]).map(c=>c==null?'':c));
  const txt=rows.map(r=>r.join(' ')).join('\n');
  const meta={fuente};
  // proveedor
  const provRow=rows.find(r=>r.some(c=>/(co\.,?\s*ltd|pte\.?\s*ltd|coltd|limited)/i.test(String(c))));
  meta.proveedor=provRow?String(provRow.find(c=>/(co\.,?\s*ltd|pte\.?\s*ltd|coltd|limited)/i.test(String(c)))).trim():'';
  // n° documento
  const lbl=/^(invoice|p\.?\s*i\.?|proforma\s*invoice)\s*(no\.?|#|number)\s*[:：.]?\s*$/i;
  for(const r of rows){ for(let i=0;i<r.length&&!meta.ref;i++){ const c=String(r[i]).trim();
    if(lbl.test(c)||/invoice\s*#/i.test(c)){const v=r.slice(i+1).find(x=>String(x).trim()); if(v) meta.ref=String(v).trim();} } if(meta.ref) break; }
  if(!meta.ref) for(const r of rows){ for(const c of r){ const m=String(c).match(/(?<!model\s*)\bno\s*[:：.]\s*([A-Z]{1,4}[-A-Z0-9]{5,})/i); if(m){meta.ref=m[1];break} } if(meta.ref) break; }
  const inc=txt.match(/\b(EXW|FOB|CIF|CFR|FCA)\b[\s,:]*([A-Z][A-Z ]{2,20})?/);
  if(inc) meta.incoterm=(inc[1]+' '+(inc[2]||'')).trim().replace(/\s+(CHINA|FACTORY)$/i,'');
  const dep=txt.match(/(\d{1,3})\s*%\s*(t\/t|deposit|dep)/i); meta.anticipo=dep?+dep[1]:(/100%\s*t\/t/i.test(txt)?100:null);
  const ready=txt.match(/(\d{2,3})\s*days?\s*after\s*(deposit|receiving)/i); if(ready) meta.produccionDias=+ready[1];
  if(/reolink/i.test(txt)) meta.formato='Reolink · invoice'; else if(/gengxin/i.test(txt)) meta.formato='Ningbo Gengxin · PI'; else if(/shenzhen future|futurescreen/i.test(txt)) meta.formato='Shenzhen Future · proforma'; else if(/longhua/i.test(txt)) meta.formato='Longhua · invoice'; else meta.formato='Formato genérico';
  // encabezado de la tabla
  const isQ=c=>/^(qty|q'?ty|quantity|quantities|cantidad|数量)/i.test(c)||/quantit/i.test(c);
  const isP=c=>/unit\s*price|单价|precio\s*unit/i.test(c);
  const isA=c=>/^(amount|total\s*(cost|amount)?|importe|总值|subtotal)/i.test(c);
  const isM=c=>/model\s*(number|no)|item\s*no|型号/i.test(c);
  const isN=c=>/model\s*name|description|commodity|product|品名|descripci/i.test(c);
  let h=-1,map={};
  rows.forEach((r,i)=>{ if(h>=0) return;
    const m={}; r.forEach((c,j)=>{c=String(c).trim(); if(!c) return;
      if(m.q==null&&isQ(c)) m.q=j; else if(m.p==null&&isP(c)) m.p=j; else if(m.a==null&&isA(c)) m.a=j; else if(m.m==null&&isM(c)) m.m=j; else if(m.n==null&&isN(c)) m.n=j; else if(m.s==null&&/size/i.test(c)) m.s=j;});
    if(m.q!=null&&m.p!=null){h=i;map=m}
  });
  const lineas=[],ajustes=[];let totalDoc=null,enAjustes=false;
  if(h>=0){
    for(let i=h+1;i<rows.length;i++){
      const r=rows[i], lab=r.filter(x=>typeof x==='string'&&x.trim()).join(' ');
      if(/grand\s*total/i.test(lab)){totalDoc=[...r].reverse().map(piNum).find(x=>!isNaN(x));break}
      if(/^\s*total/i.test(String(r[0]))||/^total[:\s]/i.test(lab)){
        const nums=r.map(piNum).filter(x=>!isNaN(x)); const t=String(r.join(' ')).match(/USD\s*([\d,.]+)/i);
        totalDoc=t?piNum(t[1]):nums.length?nums[nums.length-1]:null; enAjustes=true; continue;
      }
      const q=piNum(r[map.q]), p=piNum(r[map.p]), a=map.a!=null?piNum(r[map.a]):NaN;
      if(enAjustes){
        const v=[...r].reverse().map(piNum).find(x=>!isNaN(x));
        if(lab&&v&&!/country|remark|bank\s*name|swift|a\/c|routing|beneficiary|signature|date/i.test(lab)) ajustes.push({txt:lab.replace(/\bUSD\b/g,'').trim(),usd:v});
        continue;
      }
      if(q>0&&p>0){
        let modelo=map.m!=null?String(r[map.m]).trim():'';
        let nombre=map.n!=null?String(r[map.n]).trim():'';
        const mm=(nombre+' '+modelo).match(/MODEL\s*NO\.?\s*[:：]?\s*([A-Z0-9][A-Z0-9\-]+)/i);
        if(!modelo&&mm) modelo=mm[1].toUpperCase();
        if(map.s!=null&&r[map.s]) nombre=nombre+' '+String(r[map.s]).replace(/\*.*$/,'');
        const key=(modelo||nombre).toUpperCase().replace(/["”]/g,'').replace(/\s+/g,' ').trim();
        const sku=MODELO_SKU[modelo.toUpperCase()]||MODELO_SKU[key]||'';
        const paren=(nombre.match(/\(([^)]+)\)/)||[])[1];
        lineas.push({modelo:modelo||'—',nombre:nombre.replace(/MODEL\s*NO.*$/i,'').trim()||paren||modelo,sku,q,p,monto:isNaN(a)?q*p:a,pvp:PVP_REF[sku]||null});
      }
    }
  }
  const sumL=lineas.reduce((s,l)=>s+l.q*l.p,0), sumA=ajustes.reduce((s,a)=>s+a.usd,0);
  meta.totalDoc=totalDoc; meta.check=totalDoc!=null?Math.abs(sumL+sumA-totalDoc)<1:null;
  return {meta,lineas,ajustes,map,header:h};
}

/* Factores de importación por embarque (pestañas del Sheets IMPORTACIONES 2EBOX) */
const FQ={final:['Final','s-ok'],parcial:['Parcial','s-planificar'],validar:['Sin validar','s-comprar'],dup:['Pestaña duplicada','s-quiebre'],cot:['Cotización','s-sobre']};
function factorRows(){
  const enCot=new Set(EMB.filter(e=>e.estado==='En cotización').map(e=>e.id));
  const cots=EMB.filter(e=>enCot.has(e.id)).map(e=>({id:e.id,linea:e.linea,prov:e.prov,fecha:e.pedido,proy:e.cot?cotCalc(e).factor:(FICHA[e.id]?costeo(FICHA[e.id],'proj').factor:null),real:null,q:'cot'})).filter(x=>x.proy);
  return [...FACT.filter(f=>!enCot.has(f.id)),...cots];
}
function factorTable(){
  const rs=factorRows().filter(f=>pass('linea',f.linea)&&pass('prov',f.prov)).sort((a,b)=>D(b.fecha)-D(a.fecha));
  return `<div class="tbl-wrap"><table><thead><tr><th>Importación</th><th>Proveedor</th><th class="r">Proyectado</th><th class="r">Real</th><th class="r">Desvío</th><th>Estado del costeo</th></tr></thead><tbody>${
    rs.map(f=>{const dv=f.proy&&f.real?(f.real/f.proy-1):null;
      return `<tr><td><b>${f.id}</b><div class="hint">${fmtD(f.fecha)}</div></td><td class="lnk" style="font-size:12.5px">${f.prov}</td>
      <td class="r">${f.proy?fmtN(f.proy,3):'—'}</td><td class="r"><b>${f.real?fmtN(f.real,3):'—'}</b></td>
      <td class="r" style="color:${dv==null?'var(--ink-3)':Math.abs(dv)>.05?'var(--bad)':dv<0?'var(--ok)':'var(--warn)'}">${dv==null?'—':(dv>0?'+':'')+fmtN(dv*100,1)+'%'}</td>
      <td style="white-space:normal;min-width:160px"><span class="chip ${FQ[f.q][1]}">${FQ[f.q][0]}</span>${f.nota?`<div class="hint" style="margin-top:3px">${f.nota}</div>`:''}</td></tr>`}).join('')}
  </tbody></table></div><p class="hint" style="margin:8px 0 0">Factor = (CIF + gastos de importación) ÷ FOB, sin IVA. Desvío mayor a ±5% en rojo para revisar el costeo.</p>`;
}
let factorModo='linea';
const SERIE_COL={Chimeneas:'#6D49F2',Telones:'#05B5B5',Reolink:'#E0861A',Longhua:'#6D49F2','Shenzhen Future':'#05B5B5','Ningbo Gengxin':'#D8457A'};
let FCH_PTS=[];
function factorChart(){
  FCH_PTS=[];
  const pts=factorRows().filter(f=>(f.real||f.proy)&&pass('linea',f.linea)&&pass('prov',f.prov));
  const key=f=>factorModo==='linea'?f.linea:f.prov;
  const series=[...new Set(pts.map(key))];
  const W=640,H=270,pl=44,pr=16,pt=14,pb=30;
  const x0=D('2025-02-01'),x1=D('2026-11-30');
  const ymin=1.0,ymax=1.8;
  const X=d=>pl+(D(d)-x0)/(x1-x0)*(W-pl-pr), Y=v=>pt+(ymax-v)/(ymax-ymin)*(H-pt-pb);
  let g='';
  for(let v=1.0;v<=1.8001;v+=0.1){g+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl-6}" y="${Y(v)+4}" font-size="10.5" text-anchor="end">${v.toFixed(1).replace('.',',')}</text>`}
  for(let d=new Date(x0);d<=x1;d.setMonth(d.getMonth()+3)){const s=d.toISOString().slice(0,10);g+=`<text x="${X(s)}" y="${H-10}" font-size="10.5" text-anchor="middle">${d.toLocaleDateString('es-CL',{month:'short',year:'2-digit'}).replace('.','')}</text>`}
  series.forEach(sname=>{
    const col=SERIE_COL[sname]||'var(--ink-3)';
    const sp=pts.filter(f=>key(f)===sname).sort((a,b)=>D(a.fecha)-D(b.fecha));
    const lineP=sp.filter(f=>f.real&&(f.q==='final'||f.q==='validar'));
    if(lineP.length>1) g+=`<polyline fill="none" stroke="${col}" stroke-width="2.2" points="${lineP.map(f=>X(f.fecha)+','+Y(f.real)).join(' ')}"/>`;
    sp.forEach(f=>{
      const v=f.real&&f.q!=='parcial'?f.real:f.proy; const filled=f.real&&(f.q==='final'||f.q==='validar');
      const i=FCH_PTS.push({...f,v,filled,col,sname})-1;
      g+=`<g class="fpt" data-i="${i}" tabindex="0" role="img" aria-label="${f.id}: factor ${fmtN(v,3)}"><circle cx="${X(f.fecha)}" cy="${Y(v)}" r="13" fill="transparent"/><circle class="dot" cx="${X(f.fecha)}" cy="${Y(v)}" r="${filled?5:4.5}" fill="${filled?col:'var(--surface)'}" stroke="${col}" stroke-width="2" ${filled?'':'stroke-dasharray="2 2"'}/></g>`;
      if(filled&&f.real>1.4) g+=`<text x="${X(f.fecha)+8}" y="${Y(v)+4}" font-size="10.5" style="fill:var(--ink)">${f.id} ${fmtN(v,2)}</text>`;
    });
  });
  const last=series.map(sname=>{const sp=pts.filter(f=>key(f)===sname&&f.real&&f.q==='final').sort((a,b)=>D(b.fecha)-D(a.fecha));return sp[0]?{sname,v:sp[0].real,id:sp[0].id}:null}).filter(Boolean);
  return `<div class="legend" style="margin-bottom:6px">${series.map(s=>`<span><i style="background:${SERIE_COL[s]||'var(--ink-3)'}"></i>${s}</span>`).join('')}<span><i style="background:transparent;border:2px dashed var(--ink-3);box-sizing:border-box"></i>Proyectado / parcial</span></div>
   <div class="fchart"><svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;display:block" aria-label="Evolución del factor de importación">${g}</svg><div class="ftt" id="ftt" hidden></div></div>
   <div class="kv" style="margin-top:8px">${last.map(l=>`<div><span>Último real · ${l.sname}</span><b>${fmtN(l.v,3)}</b><span>${l.id}</span></div>`).join('')}</div>`;
}

function bindFactorChart(){
  const tt=$('#ftt'); if(!tt) return; const box=tt.parentElement;
  const show=g=>{
    const f=FCH_PTS[+g.dataset.i]; if(!f) return;
    document.querySelectorAll('.fpt.on').forEach(x=>x.classList.remove('on')); g.classList.add('on');
    const dv=f.proy&&f.real?(f.real/f.proy-1):null;
    tt.innerHTML=`<div style="display:flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${f.col};display:inline-block"></i><b>${f.id}</b></div>
      <div class="hint">${f.prov} · pedido ${fmtD(f.fecha)}</div>
      <div class="ftt-row"><span>Real</span><b>${f.real&&f.q!=='parcial'?fmtN(f.real,3):f.real?fmtN(f.real,3)+' (parcial)':'—'}</b></div>
      <div class="ftt-row"><span>Proyectado</span><b>${f.proy?fmtN(f.proy,3):'—'}</b></div>
      ${dv!=null&&f.q!=='parcial'?`<div class="ftt-row"><span>Desvío</span><b style="color:${Math.abs(dv)>.05?'var(--bad)':dv<0?'var(--ok)':'var(--warn)'}">${(dv>0?'+':'')+fmtN(dv*100,1)}%</b></div>`:''}
      <div style="margin-top:4px"><span class="chip ${FQ[f.q][1]}" style="font-size:11px">${FQ[f.q][0]}</span></div>`;
    tt.hidden=false;
    const b=box.getBoundingClientRect(), r=g.querySelector('.dot').getBoundingClientRect();
    const cx=r.left+r.width/2-b.left, cy=r.top-b.top;
    const w=tt.offsetWidth, h=tt.offsetHeight;
    let left=cx-w/2; left=Math.max(0,Math.min(left,b.width-w));
    let top=cy-h-10; if(top<0) top=cy+r.height+14;
    tt.style.left=left+'px'; tt.style.top=top+'px';
  };
  const hide=()=>{tt.hidden=true;document.querySelectorAll('.fpt.on').forEach(x=>x.classList.remove('on'))};
  document.querySelectorAll('.fpt').forEach(g=>{g.addEventListener('mouseenter',()=>show(g));g.addEventListener('focus',()=>show(g));g.addEventListener('click',()=>show(g));g.addEventListener('mouseleave',hide);g.addEventListener('blur',hide)});
}

/* Evaluación de cotización */
function cotCalc(e){
  const c=e.cot, m=P[e.linea]?.margen??15;
  const fobL=c.lineas.reduce((s,l)=>s+l.q*l.p,0), aj=(c.ajustes||[]).reduce((s,a)=>s+a.usd,0), fob=fobL+aj;
  const otros=+c.flete+ +c.seguro+ (+c.localesCLP)/c.tc + fob*(+c.adval)/100;
  const factor=fob>0?(fob+otros)/fob:0;
  const ls=c.lineas.map(l=>{
    const pu=l.p*(fob/(fobL||1)); // prorratea ajustes
    const nn=pu*c.tc*factor, e2=nn/(1-m/100), neto=l.pvp?l.pvp/1.19:null;
    const mg=neto?(neto-e2)/neto:null;
    const s=l.sku&&SKUS.find(x=>x.sku===l.sku); const r=s?calc(s):null;
    const cobMeses=r&&r.prom?(l.q+r.pos)/r.prom:null;
    return {...l,nn,e2,neto,mg,prom:r?r.prom:null,pos:r?r.pos:null,cobMeses};
  });
  const inv=(fob+ +c.flete+ +c.seguro)*c.tc+ +c.localesCLP;
  const venta=ls.reduce((s,l)=>s+(l.neto?l.neto*l.q:0),0), costo=ls.reduce((s,l)=>s+(l.neto?l.e2*l.q:0),0);
  const mgP=venta?(venta-costo)/venta:null;
  const hist=FACT.filter(f=>f.prov===e.prov&&f.real&&f.q==='final').map(f=>f.real);
  return {fob,factor,ls,inv,mgP,hist,m};
}
function veredicto(k){
  if(k.mgP==null) return ['Faltan precios de venta','s-nuevo'];
  const neg=k.ls.some(l=>l.mg!=null&&l.mg<0), cob=k.ls.some(l=>l.cobMeses!=null&&l.cobMeses>12);
  if(k.mgP<.15||neg) return [neg?'Revisar: hay productos con margen negativo':'No conviene: margen bajo','s-quiebre'];
  if(cob) return ['Conviene en margen, pero la cantidad cubre más de 12 meses','s-comprar'];
  if(k.mgP<.3) return ['Revisar: margen ajustado','s-comprar'];
  return ['Conviene','s-ok'];
}
function cotResult(e){
  const k=cotCalc(e), v=veredicto(k);
  return `<div class="kv">
    <div><span>FOB total</span><b>${fmtUSD(k.fob)}</b></div>
    <div><span>Factor proyectado</span><b>${fmtN(k.factor,3)}</b><span>${k.hist.length?'Histórico proveedor '+k.hist.map(x=>fmtN(x,2)).join(' · '):'Sin historial del proveedor'}</span></div>
    <div><span>Inversión (sin IVA)</span><b>${fmtCLP(k.inv)}</b></div>
    <div><span>Margen bruto 2ebox</span><b style="color:${k.mgP==null?'inherit':k.mgP<.15?'var(--bad)':k.mgP<.3?'var(--warn)':'var(--ok)'}">${k.mgP==null?'—':fmtN(k.mgP*100,1)+'%'}</b><span>después de margen Netnow ${k.m}%</span></div>
  </div>
  <div style="margin:10px 0"><span class="chip ${v[1]}">${v[0]}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Modelo</th><th>SKU</th><th class="r">Cant.</th><th class="r">FOB u.</th><th class="r">Costo 2ebox</th><th class="r">PVP bruto</th><th class="r">Margen</th><th class="r">Venta/mes</th><th class="r">Cobertura</th></tr></thead><tbody>
   ${k.ls.map((l,i)=>`<tr><td style="white-space:normal;min-width:140px"><b class="mono">${l.modelo}</b><div class="hint">${l.nombre}</div></td><td class="mono">${l.sku||'<span class="hint">nuevo</span>'}</td><td class="r">${fmtN(l.q)}</td><td class="r">${fmtN(l.p,2)}</td><td class="r">${fmtCLP(l.e2)}</td>
     <td class="r"><input class="pvp" data-i="${i}" type="number" value="${l.pvp||''}" placeholder="ingresar" style="width:96px;text-align:right;padding:4px 6px"></td>
     <td class="r" style="color:${l.mg==null?'inherit':l.mg<0?'var(--bad)':l.mg<.3?'var(--warn)':'var(--ok)'}"><b>${l.mg==null?'—':fmtN(l.mg*100,1)+'%'}</b></td>
     <td class="r">${l.prom?fmtN(l.prom,1):'—'}</td><td class="r" style="color:${l.cobMeses>12?'var(--warn)':'inherit'}">${l.cobMeses?fmtN(l.cobMeses,1)+' m':'—'}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="hint" style="margin:6px 0 0">Margen sobre PVP neto (sin IVA), antes de comisión de marketplace y despacho. Cobertura = (cantidad + stock + en camino) ÷ venta mensual actual.</p>`;
}
function cotDrawer(id){
  const e=EMB.find(x=>x.id===id), c=e.cot;
  openDrawer(`<div><span class="eyebrow">En cotización · ${e.linea} · ${e.prov}</span><h2 style="font-size:20px;margin-top:4px">${e.id} <span class="mono lnk" style="font-size:14px">${e.ref||''}</span></h2>
    <div class="hint">${c.fuente||''}${c.ejemplo?' · <b>ejemplo</b>':''}</div></div>
   ${c.alerta?`<div class="note" style="color:var(--warn)">${c.alerta}</div>`:''}
   <div class="panel" style="padding:12px 14px"><h3 style="margin-bottom:8px">Supuestos de internación</h3>
    <div class="fields" id="cot-in">
     <label>T/C<input data-c="tc" type="number" value="${c.tc}"></label>
     <label>Flete USD<input data-c="flete" type="number" value="${c.flete}"><span class="hint">${c.fleteRef||''}</span></label>
     <label>Seguro USD<input data-c="seguro" type="number" value="${c.seguro}"></label>
     <label>Gastos locales CLP<input data-c="localesCLP" type="number" value="${c.localesCLP}"><span class="hint">Despacho, AGA, almacenaje, flete a CD</span></label>
     <label>Ad valorem %<input data-c="adval" type="number" value="${c.adval}"><span class="hint">0% origen China (TLC) · 6% general</span></label>
    </div></div>
   ${(c.ajustes||[]).length?`<div class="note">Ajustes de la PI incluidos en el FOB: ${c.ajustes.map(a=>`${a.txt} ${a.usd>0?'+':''}${fmtN(a.usd)}`).join(' · ')}</div>`:''}
   <div id="cot-out">${cotResult(e)}</div>
   <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="cot-desc">Descartar</button><button class="btn primary" id="cot-ok" style="margin-left:auto">Aprobar y pasar a producción</button></div>`);
  const upd=()=>{$('#cot-out').innerHTML=cotResult(e);bindPvp()};
  const bindPvp=()=>document.querySelectorAll('#cot-out .pvp').forEach(i=>i.onchange=()=>{c.lineas[+i.dataset.i].pvp=+i.value||null;upd();guardarLuego(e.id)});
  document.querySelectorAll('#cot-in input').forEach(i=>i.oninput=()=>{c[i.dataset.c]=+i.value||0;upd();guardarLuego(e.id)});
  bindPvp();
  $('#cot-desc').onclick=async()=>{if(!confirm(`¿Descartar ${e.id}? Se borra de la base.`))return;EMB.splice(EMB.indexOf(e),1);delete PAGOS[e.id];delete FICHA[e.id];closeDrawer();render();try{await Store.borrarImportacion(e.id);toast(`${e.id} descartada.`)}catch(err){toast('No se pudo borrar: '+err.message)}};
  $('#cot-ok').onclick=()=>{
    const k=cotCalc(e), a=(c.anticipo||30)/100, hoy=HOY_S;
    e.estado='En producción'; e.pedido=hoy; e.fob=k.fob; e.u=c.lineas.reduce((s,l)=>s+l.q,0); e.flete=+c.flete;
    e.pagos=[[a<1?`Anticipo ${c.anticipo||30}%`:'Pago 100%',k.fob*a,c.tc,hoy]];
    materializarPagos(e,true); guardar(e.id,'Aprobar cotización');
    closeDrawer();toast(`${e.id} aprobada: pasa a "En producción" y sus pagos entran al flujo de caja.`);render();
  };
}

/* Subir PI */
let piUlt=null;
function piDrawer(){
  openDrawer(`<div><span class="eyebrow">Nueva cotización</span><h2 style="font-size:20px;margin-top:4px">Subir PI del proveedor</h2>
    <p style="margin:6px 0 0;color:var(--ink-2)">Sube la proforma tal como la manda el proveedor. Se detecta la tabla de productos (modelo, cantidad, precio unitario, monto), los ajustes, el n° de PI, el incoterm y la condición de pago.</p></div>
   <label class="drop" id="drop"><input type="file" id="pi-file" accept=".xlsx,.xls,.csv,.pdf" hidden>
     <b>Arrastra el archivo o haz clic para elegirlo</b><span class="hint">Excel (.xlsx, .xls) o CSV. Si la PI llegó en PDF, pide el Excel al proveedor o carga los productos a mano en la ficha.</span></label>
   <div id="pi-out"></div>`);
  const show=(aoa,fuente,lineaHint)=>{piUlt={...parsePI(aoa,fuente),lineaHint};$('#pi-out').innerHTML=piPreview(piUlt);bindPiPreview()};
  const inp=$('#pi-file'), drop=$('#drop');
  const leer=f=>{
    if(!f) return;
    if(/\.pdf$/i.test(f.name)){$('#pi-out').innerHTML=`<div class="note">${f.name}: por ahora solo se leen PI en Excel. Carga los productos a mano en la ficha o pide el Excel al proveedor.</div>`;return}
    if(typeof XLSX==='undefined'){$('#pi-out').innerHTML='<div class="err">No se pudo cargar el lector de Excel. Revisa la conexión y vuelve a intentar.</div>';return}
    const fr=new FileReader();
    fr.onload=ev=>{try{const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]]; show(XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}),f.name,null)}
      catch(err){$('#pi-out').innerHTML=`<div class="err">No se pudo leer ${f.name}. Verifica que sea un Excel válido.</div>`}};
    fr.readAsArrayBuffer(f);
  };
  inp.onchange=()=>leer(inp.files[0]);
  drop.ondragover=ev=>{ev.preventDefault();drop.classList.add('over')};
  drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=ev=>{ev.preventDefault();drop.classList.remove('over');leer(ev.dataTransfer.files[0])};
}
function piPreview(r){
  const m=r.meta;
  if(!r.lineas.length) return `<div class="note" style="color:var(--bad)">No encontré una tabla con columnas de cantidad y precio unitario en ${m.fuente}. Revisa que la PI esté en la primera hoja.</div>`;
  const sumL=r.lineas.reduce((s,l)=>s+l.q*l.p,0), sumA=r.ajustes.reduce((s,a)=>s+a.usd,0);
  const provs=[...new Set(EMB.map(e=>e.prov))];
  const provGuess=provs.find(p=>new RegExp(p.split(' ')[0],'i').test(m.proveedor+' '+m.formato))||m.proveedor;
  return `<div class="panel" style="padding:12px 14px;display:grid;gap:12px">
   <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="chip s-sobre">${m.formato}</span>${m.check===true?'<span class="chip s-ok">Total cuadra con la PI</span>':m.check===false?'<span class="chip s-quiebre">El total no cuadra: revisar</span>':''}<span class="hint">${r.lineas.length} productos · ${r.ajustes.length} ajustes</span></div>
   <div class="fields">
    <label>N° PI / invoice<input id="pi-ref" class="mono" value="${m.ref||''}"></label>
    <label>Proveedor<input id="pi-prov" value="${provGuess}"></label>
    <label>Línea<select id="pi-linea">${['Chimeneas','Telones','Reolink'].map(l=>`<option ${l===(r.lineaHint||(/reolink/i.test(m.formato)?'Reolink':/shenzhen/i.test(m.formato)?'Telones':'Chimeneas'))?'selected':''}>${l}</option>`).join('')}</select></label>
    <label>Incoterm<input id="pi-inc" value="${m.incoterm||''}"></label>
    <label>Anticipo %<input id="pi-ant" type="number" value="${m.anticipo??30}"></label>
    <label>Producción (días)<input id="pi-prod" type="number" value="${m.produccionDias||''}" placeholder="—"></label>
   </div>
   <div class="tbl-wrap"><table><thead><tr><th>Modelo</th><th>Descripción</th><th>SKU</th><th class="r">Cant.</th><th class="r">Precio u.</th><th class="r">Monto</th></tr></thead><tbody>
    ${r.lineas.map((l,i)=>`<tr><td class="mono">${l.modelo}</td><td style="white-space:normal;min-width:150px">${l.nombre}</td><td><input class="mono pi-sku" data-i="${i}" value="${l.sku}" placeholder="nuevo" style="width:120px;padding:4px 6px"></td><td class="r">${fmtN(l.q)}</td><td class="r">${fmtN(l.p,2)}</td><td class="r">${fmtN(l.q*l.p)}</td></tr>`).join('')}
    ${r.ajustes.map(a=>`<tr><td colspan="5" style="color:var(--ink-2)">${a.txt}</td><td class="r">${fmtN(a.usd)}</td></tr>`).join('')}
    <tr><td colspan="5"><b>Total</b>${m.totalDoc!=null?` <span class="hint">· PI dice ${fmtUSD(m.totalDoc)}</span>`:''}</td><td class="r"><b>${fmtN(sumL+sumA)}</b></td></tr>
   </tbody></table></div>
   <div style="display:flex"><button class="btn primary" id="pi-crear" style="margin-left:auto">Crear cotización y evaluar</button></div></div>`;
}
function bindPiPreview(){
  document.querySelectorAll('.pi-sku').forEach(i=>i.onchange=()=>{const l=piUlt.lineas[+i.dataset.i];l.sku=i.value.trim();l.pvp=PVP_REF[l.sku]||l.pvp});
  const b=$('#pi-crear'); if(!b) return;
  if(piDestino&&FICHA[piDestino]){ b.textContent='Usar estos productos en la ficha'; b.onclick=()=>{
    const f=FICHA[piDestino];
    f.items=piUlt.lineas.map(l=>({sku:l.sku||l.modelo,nombre:l.nombre||l.modelo,q:l.q,p:l.p}));
    f.ajuste=piUlt.ajustes.reduce((s,a)=>s+a.usd,0);
    if(!f.ref) f.ref=$('#pi-ref').value; if($('#pi-ant').value) f.anticipo=+$('#pi-ant').value;
    const inc=($('#pi-inc').value||'').split(' ')[0].toUpperCase(); if(INCOTERMS.includes(inc)) f.incoterm=inc;
    f.items.forEach(it=>{if(!f.precios[it.sku]) f.precios[it.sku]=Object.fromEntries(PORTALES.map(([k])=>[k,PVP_REF[it.sku]||null]))});
    piDestino=null; closeDrawer(); render(); toast('Productos de la PI cargados en la ficha.'); }; return; }
  b.onclick=()=>{
    const linea=$('#pi-linea').value, n=EMB.filter(e=>e.estado==='En cotización').length+1;
    const id=`Cot. ${linea} ${n}`.replace(/\s+/g,' ');
    const u=piUlt.lineas.reduce((s,l)=>s+l.q,0), fob=piUlt.lineas.reduce((s,l)=>s+l.q*l.p,0);
    const fleteU={Chimeneas:7.8,Telones:5.7,Reolink:5.8}[linea];
    const e={id,linea,prov:$('#pi-prov').value,via:linea==='Reolink'?'Aéreo':'Marítimo',tipo:linea==='Reolink'?'Aéreo':'Marítimo',u,estado:'En cotización',pedido:HOY_S,fob,ref:$('#pi-ref').value,desc:piUlt.lineas.map(l=>l.nombre||l.modelo).slice(0,3).join(', '),pol:null,pagos:[],docs:{PI:1,Invoice:0,'Packing list':0,BL:0,DIN:0,Swift:0,'Set importación':0},
      cot:{fuente:'Leída desde '+piUlt.meta.fuente,tc:TC,flete:Math.round(u*fleteU),fleteRef:`Estimado ${fleteU} US$/u según importaciones anteriores`,seguro:25,localesCLP:linea==='Reolink'?180000:1194654,adval:0,anticipo:+$('#pi-ant').value||30,lineas:piUlt.lineas.map(l=>({...l})),ajustes:piUlt.ajustes}};
    if(EMB.some(x=>x.id===id)){toast('Ya existe '+id);return}
    EMB.push(e); materializarPagos(e,true); guardar(id,'Cotización desde PI'); closeDrawer(); cur='importaciones'; FIL.estado.clear(); FIL.estado.add('En cotización'); render(); cotDrawer(id);
  };
}

/* ---------- FICHA DE IMPORTACIÓN (costeo proyectado vs real y ventas por portal) ---------- */
const GASTOS=[['origen','Gastos origen'],['adicionales','Gastos adicionales destino'],['almacenaje','Almacenaje'],['despacho','Gastos despacho'],['aga','Honorarios AGA'],['embarcador','Gastos locales embarcador'],['garantia','Garantía contenedor'],['bodega','Flete puerto / bodega'],['otros','Otros gastos']];
const PORTALES=[['shopify','Retail.cl (Shopify)'],['meli','Mercado Libre'],['fala','Falabella'],['walmart','Walmart']];
const BALANCE={produccion:'Contra producción lista',embarque:'Antes del embarque',bl:'Contra copia / liberación del BL',arribo:'Al arribo a Chile'};
const INCOTERMS=['EXW','FCA','FOB','CFR','CIF','DAP','DDP'];
const G0=()=>Object.fromEntries(GASTOS.map(([k])=>[k,null]));
const gx=o=>Object.assign(G0(),o);
function normFicha(id,f){
  const e=EMB.find(x=>x.id===id)||{};
  f.id=id; f.linea=f.linea||e.linea; f.proveedor=f.proveedor||e.prov; f.via=f.via||e.via||'Marítimo'; f.estado=e.estado;
  f.items=(f.items||[]).map(x=>Array.isArray(x)?{sku:x[0],nombre:x[1],q:x[2],p:x[3]}:x);
  f.ajuste=f.ajuste||0; f.projTc=f.projTc||'aduana';
  f.margenNN=f.margenNN??NN_DEF[f.linea]??15;
  f.portales=f.portales||JSON.parse(JSON.stringify(PORTAL_DEF));
  f.precios=JSON.parse(JSON.stringify(f.precios||{})); f.envio=JSON.parse(JSON.stringify(f.envio||{}));
  f.items.forEach(it=>{const pv=PVP_REF[it.sku]; if(!f.precios[it.sku]) f.precios[it.sku]=Object.fromEntries(PORTALES.map(([k])=>[k,pv||null]));});
  return f;
}

function fichaDe(id){
  if(FICHA[id]) return FICHA[id];
  const e=EMB.find(x=>x.id===id); if(!e) return null;
  const base=Object.values(FICHA).filter(f=>f.linea===e.linea&&f.real.fobClp).slice(-1)[0]||Object.values(FICHA)[0];
  const pg=PAGOS[id]||[], pr=pg.filter(p=>p[1]==='prov'&&p[3]==='USD');
  const fobClp=pr.length?pr.reduce((s,p)=>s+p[4]*(p[5]||TC),0):null;
  const iva=pg.find(p=>p[1]==='imp'&&p[6]!=='Estimado'), fl=pg.find(p=>p[1]==='flete'&&p[6]==='Correo');
  const items=(ITEMS_EXTRA[id]||[]).map(x=>[...x]);
  const sumI=items.reduce((s,x)=>s+x[2]*x[3],0);
  const f={ref:e.ref,incoterm:base.incoterm,pol:e.pol,via:e.via,tcHoy:TC,tcAduana:base.tcAduana,tcReal:fobClp&&e.fob?Math.round(fobClp/e.fob*100)/100:null,
    anticipo:base.anticipo,balance:base.balance,items,ajuste:e.fob&&sumI?Math.round((e.fob-sumI)*100)/100:0,
    proj:JSON.parse(JSON.stringify(base.proj)),
    real:{fobClp,flete:fl?[fl[4],fl[4]*(fl[5]||TC)]:null,seguro:null,ivaClp:iva?iva[4]:null,g:G0()},
    precios:base.linea===e.linea&&base.precios?base.precios:null,envio:base.envio};
  FICHA[id]=normFicha(id,f); return FICHA[id];
}
/* Costeo de una columna (proj | real), con las fórmulas de la pestaña del Sheets */
function costeo(f,col){
  const fobU=f.items.reduce((s,i)=>s+(+i.q||0)*(+i.p||0),0)+(+f.ajuste||0);
  const tcP=f.projTc==='hoy'?f.tcHoy:f.tcAduana;
  const c=f[col], tc=col==='proj'?tcP:(f.tcReal||null);
  const fobC=col==='proj'?fobU*tcP:c.fobClp;
  const fl=c.flete||null, sg=c.seguro||null;
  const vals=GASTOS.map(([k])=>c.g[k]);
  const faltan=col==='real'?[fobC==null,!fl,!sg,c.ivaClp==null,...vals.map(v=>v==null)].filter(Boolean).length:0;
  const gC=vals.reduce((s,v)=>s+(+v||0),0);
  const cifU=fobU+(fl?+fl[0]:0)+(sg?+sg[0]:0), cifC=(fobC||0)+(fl?+fl[1]:0)+(sg?+sg[1]:0);
  const ivaU=0.19*cifU, ivaC=col==='proj'?ivaU*f.tcAduana:(c.ivaClp??null);
  const tcG=f.tcAduana;
  const ivaG=0.19*gC;
  const totC=cifC+gC, totU=cifU+gC/tcG;
  const totIvaC=(ivaC||0)+ivaG, totIvaU=(ivaC!=null?ivaC/f.tcAduana:0)+ivaG/tcG;
  const factor=fobC?totC/fobC:null;
  return {fobU,fobC,fl,sg,cifU,cifC,ivaU,ivaC,gC,tcG,ivaG,totC,totU,totIvaC,totIvaU,brutoC:totC+totIvaC,brutoU:totU+totIvaU,factor,faltan,tc};
}
let fichaId=null, fichaNueva=false, fichaPortal='meli';
function abrirFicha(id){fichaId=id;fichaNueva=false;fichaDe(id);cur='ficha';render();window.scrollTo(0,0)}
function nuevaFicha(){
  const base=Object.keys(FICHA).filter(k=>k!=='__nueva'&&EMB.some(e=>e.id===k)).sort((a,b)=>String(EMB.find(e=>e.id===a).pedido).localeCompare(String(EMB.find(e=>e.id===b).pedido))).pop()||EMB[EMB.length-1]?.id, b=fichaDe(base);
  const f=JSON.parse(JSON.stringify(b));
  Object.assign(f,{id:'',ref:'',base,tcReal:null,real:{fobClp:null,flete:null,seguro:null,ivaClp:null,g:G0()}});
  FICHA.__nueva=f; fichaId='__nueva'; fichaNueva=true; cur='ficha'; render(); window.scrollTo(0,0);
}
const n2=v=>v==null||v===''?'':fmtN(v,2), n0=v=>v==null||v===''?'':Math.round(v).toLocaleString('es-CL');
const inp=(path,val,opt={})=>`<input class="fin${opt.cls?' '+opt.cls:''}" data-p="${path}" type="${opt.type||'number'}" step="any" value="${val??''}" placeholder="${opt.ph||''}" ${opt.w?`style="width:${opt.w}"`:''}>`;
function fichaView(){
  const f=FICHA[fichaId]; if(!f) return '<p>Importación no encontrada.</p>';
  const P_=costeo(f,'proj'), R=costeo(f,'real');
  const realOk=R.faltan===0, fUse=realOk?R:P_;
  const tcUse=realOk?(f.tcReal||f.tcHoy):(f.projTc==='hoy'?f.tcHoy:f.tcAduana);
  const eObj=EMB.find(x=>x.id===f.id);
  const linea=f.linea, nn=f.margenNN;
  const head=fichaNueva?`<span class="eyebrow">Nueva importación</span><h2 style="font-size:22px;margin-top:4px">Crear importación</h2>`
    :`<span class="eyebrow">${linea} · ${f.proveedor} · ${f.via}</span><h2 style="font-size:22px;margin-top:4px">${f.id} <span class="mono lnk" style="font-size:15px">${f.ref||'sin referencia'}</span></h2>`;
  const baseOpts=Object.keys(FICHA).filter(k=>k!=='__nueva').map(k=>`<option ${f.base===k?'selected':''}>${k}</option>`).join('');
  // 1 datos
  const s1=`<div class="panel"><header><h3><span class="stepn">1</span>Datos de la importación</h3>${fichaNueva?'<span class="sub">Parte desde una importación pasada: copia productos, gastos proyectados y condiciones</span>':''}</header>
    <div class="fields">
     ${fichaNueva?`<label>Basada en<select class="fin" data-p="base">${baseOpts}</select></label>`:''}
     <label>N° de importación${inp('id',f.id,{type:'text',ph:'Ej. Chimenea 6'})}<span class="hint">Igual al nombre de la carpeta en Drive</span></label>
     <label>Referencia oficial${inp('ref',f.ref,{type:'text',ph:'Código del embarque (PI / invoice)'})}<span class="hint">Se agrega cuando el proveedor confirma</span></label>
     <label>Proveedor${inp('proveedor',f.proveedor,{type:'text'})}</label>
     <label>Línea<select class="fin" data-p="linea">${['Chimeneas','Telones','Reolink'].map(l=>`<option ${l===linea?'selected':''}>${l}</option>`).join('')}</select></label>
     <label>Incoterm<select class="fin" data-p="incoterm">${INCOTERMS.map(i=>`<option ${i===f.incoterm?'selected':''}>${i}</option>`).join('')}</select></label>
     <label>Vía<select class="fin" data-p="via">${['Marítimo 20GP','Marítimo 40HQ','Marítimo 40NOR','Marítimo LCL','Aéreo','Local'].map(v=>`<option ${f.via===v||(f.via==='Marítimo'&&v==='Marítimo 20GP')?'selected':''}>${v}</option>`).join('')}</select></label>
     <label>Puerto de origen (POL)${inp('pol',f.pol,{type:'text'})}</label>
    </div></div>`;
  // 2 productos
  const s2=`<div class="panel"><header><h3><span class="stepn">2</span>Mix de productos</h3><span class="sub">Precios ${f.incoterm}</span><button class="btn soft" id="f-pi" style="margin-left:auto;font-size:12.5px;padding:6px 12px">Cargar desde PI</button></header>
    <div class="tbl-wrap"><table><thead><tr><th>SKU</th><th>Producto</th><th class="r">Unidades</th><th class="r">Precio unit. USD</th><th class="r">Total USD</th><th></th></tr></thead><tbody>
    ${f.items.map((it,i)=>`<tr><td>${inp(`items.${i}.sku`,it.sku,{type:'text',cls:'mono',w:'130px'})}</td><td>${inp(`items.${i}.nombre`,it.nombre,{type:'text',w:'220px'})}</td><td class="r">${inp(`items.${i}.q`,it.q,{w:'90px'})}</td><td class="r">${inp(`items.${i}.p`,it.p,{w:'100px'})}</td><td class="r">${n2((+it.q||0)*(+it.p||0))}</td><td><button class="icbtn" data-del="${i}" title="Quitar">✕</button></td></tr>`).join('')}
    <tr><td colspan="4" style="color:var(--ink-2)">Ajustes de la PI (descuentos, cargos bancarios, apoyo flete)</td><td class="r">${inp('ajuste',f.ajuste,{w:'100px'})}</td><td></td></tr>
    <tr><td colspan="2"><button class="lnk" id="f-add" style="background:none;border:0;cursor:pointer">+ Agregar producto</button></td><td class="r"><b>${fmtN(f.items.reduce((s,i)=>s+(+i.q||0),0))}</b></td><td></td><td class="r"><b>${n2(P_.fobU)}</b></td><td></td></tr>
    </tbody></table></div></div>`;
  // 3 pago
  const ant=(+f.anticipo||0)/100;
  const s3=`<div class="panel"><header><h3><span class="stepn">3</span>Forma de pago al proveedor</h3></header>
    <div class="fields">
     <label>Pago adelantado (%)${inp('anticipo',f.anticipo)}<span class="hint">USD ${n2(P_.fobU*ant)} al confirmar la orden</span></label>
     <label>Pago del balance<select class="fin" data-p="balance">${Object.entries(BALANCE).map(([k,l])=>`<option value="${k}" ${f.balance===k?'selected':''}>${l}</option>`).join('')}</select><span class="hint">${ant<1?`Balance USD ${n2(P_.fobU*(1-ant))}`:'Sin balance: pago 100% adelantado'}</span></label>
    </div></div>`;
  // 4 tipo de cambio
  const s4=`<div class="panel"><header><h3><span class="stepn">4</span>Tipo de cambio</h3></header>
    <div class="fields">
     <label>Dólar hoy${inp('tcHoy',f.tcHoy)}<a class="hint lnk" href="https://si3.bcentral.cl/indicadoressiete/secure/Serie.aspx?gcode=PRE_TCO" target="_blank" rel="noopener">Banco Central · dólar observado ↗</a></label>
     <label>Dólar aduanero del mes${inp('tcAduana',f.tcAduana)}<a class="hint lnk" href="https://www.aduana.cl/tipo-de-cambio-2020-2024/aduana/2019-12-27/112312.html" target="_blank" rel="noopener">Aduana · tipo de cambio ↗</a></label>
     <label>Proyectar con<select class="fin" data-p="projTc"><option value="aduana" ${f.projTc==='aduana'?'selected':''}>Dólar aduanero</option><option value="hoy" ${f.projTc==='hoy'?'selected':''}>Dólar hoy</option></select><span class="hint">El IVA siempre usa el aduanero</span></label>
     <label>T/C real promedio de pagos${inp('tcReal',f.tcReal,{ph:'Se calcula al pagar'})}<span class="hint">Promedio ponderado anticipo + balance</span></label>
    </div>
    <p class="hint" style="margin:8px 0 0">En la versión final, el dólar observado se actualiza solo cada mañana desde la API del Banco Central y el aduanero se toma al inicio de cada mes.</p></div>`;
  // 5 costeo
  const row=(lbl,pu,pc,ru,rc,opt={})=>`<tr class="${opt.cls||''}"><td>${lbl}${opt.tag?` <span class="hint">${opt.tag}</span>`:''}</td><td class="r">${pu}</td><td class="r">${pc}</td><td class="r rc">${ru}</td><td class="r rc">${rc}</td></tr>`;
  const v=(x,d=2)=>x==null?'<span class="hint">—</span>':(d?n2(x):n0(x));
  const s5=`<div class="panel"><header><h3><span class="stepn">5</span>Costeo de la importación</h3>
     <span class="chip ${realOk?'s-ok':'s-comprar'}" style="margin-left:auto">${realOk?'Costeo real completo':`Real pendiente: ${R.faltan} ${R.faltan===1?'campo':'campos'}`}</span>${f.validar?'<span class="chip s-comprar">Sin validar</span>':''}</header>
    <p class="hint" style="margin:-6px 0 10px">Edita cualquier gasto proyectado. La columna real se completa con la DIN, las facturas y los Swift de la carpeta o el correo.</p>
    <div class="tbl-wrap"><table class="costeo"><thead><tr><th></th><th class="r" colspan="2" style="background:var(--warn-bg)">PROYECTADO</th><th class="r" colspan="2" style="background:var(--ok-bg)">REAL</th></tr>
     <tr><th>Concepto</th><th class="r">USD</th><th class="r">CLP</th><th class="r">USD</th><th class="r">CLP</th></tr></thead><tbody>
     ${row(f.incoterm,n2(P_.fobU),n0(P_.fobC),n2(P_.fobU),inp('real.fobClp',R.fobC,{ph:'desde pagos',w:'120px'}))}
     ${row('Flete',inp('proj.flete.0',P_.fl?.[0],{w:'90px'}),inp('proj.flete.1',P_.fl?.[1],{w:'110px'}),inp('real.flete.0',R.fl?.[0],{w:'90px'}),inp('real.flete.1',R.fl?.[1],{w:'110px'}))}
     ${row('Seguro',inp('proj.seguro.0',P_.sg?.[0],{w:'90px'}),inp('proj.seguro.1',P_.sg?.[1],{w:'110px'}),inp('real.seguro.0',R.sg?.[0],{w:'90px'}),inp('real.seguro.1',R.sg?.[1],{w:'110px'}))}
     ${row('<b>CIF</b>',`<b>${n2(P_.cifU)}</b>`,`<b>${n0(P_.cifC)}</b>`,`<b>${n2(R.cifU)}</b>`,`<b>${R.fobC!=null?n0(R.cifC):'—'}</b>`,{cls:'hl'})}
     ${row('IVA (19%)',n2(P_.ivaU),n0(P_.ivaC),n2(R.ivaC!=null?R.ivaC/f.tcAduana:null),inp('real.ivaClp',R.ivaC,{ph:'DIN',w:'110px'}),{tag:'crédito fiscal'})}
     ${GASTOS.map(([k,l])=>row(l,n2((+f.proj.g[k]||0)/P_.tcG),inp(`proj.g.${k}`,f.proj.g[k],{w:'110px'}),n2(f.real.g[k]!=null?f.real.g[k]/R.tcG:null),inp(`real.g.${k}`,f.real.g[k],{w:'110px',ph:'pendiente'}))).join('')}
     ${row('<b>TOTAL GASTOS IMPORTACIÓN</b>',`<b>${n2(P_.gC/P_.tcG)}</b>`,`<b>${n0(P_.gC)}</b>`,`<b>${n2(R.gC/R.tcG)}</b>`,`<b>${n0(R.gC)}</b>`,{cls:'hl'})}
     ${row('IVA gastos',n2(P_.ivaG/P_.tcG),n0(P_.ivaG),n2(R.ivaG/R.tcG),n0(R.ivaG))}
     ${row('TOTAL IMPORTACIÓN',n2(P_.totU),n0(P_.totC),n2(R.totU),realOk?n0(R.totC):v(null),{cls:'tot'})}
     ${row('TOTAL IVA',n2(P_.totIvaU),n0(P_.totIvaC),n2(R.totIvaU),n0(R.totIvaC),{cls:'tot'})}
     ${row('TOTAL IMPORTACIÓN BRUTO',n2(P_.brutoU),n0(P_.brutoC),n2(R.brutoU),realOk?n0(R.brutoC):v(null),{cls:'tot'})}
     <tr class="factor"><td>FACTOR IMPORTACIÓN</td><td></td><td class="r"><b>${P_.factor?fmtN(P_.factor,3):'—'}</b></td><td></td><td class="r"><b>${realOk&&R.factor?fmtN(R.factor,3):R.factor?`<span class="hint">parcial ${fmtN(R.factor,3)}</span>`:'—'}</b></td></tr>
    </tbody></table></div></div>`;
  // 6 costeo por producto
  const s6=`<div class="panel"><header><h3><span class="stepn">6</span>Costeo por producto</h3><span class="sub">Con factor ${realOk?'real':'proyectado'} ${fUse.factor?fmtN(fUse.factor,3):'—'} · T/C ${fmtN(tcUse,2)}</span></header>
    <div class="tbl-wrap"><table><thead><tr><th>Producto / modelo</th><th class="r">Unidades</th><th class="r">FOB/u</th><th class="r">FOB total</th><th class="r">% peso</th><th class="r">Valor en CHL (USD/u)</th><th class="r">Costo CLP neto</th><th class="r">Costo total CLP</th></tr></thead><tbody>
    ${f.items.map(it=>{const ft=(+it.q||0)*(+it.p||0);const vu=(+it.p||0)*(fUse.factor||0);const cc=vu*tcUse;return `<tr><td><b class="mono">${it.sku||'—'}</b><div class="hint">${it.nombre||''}</div></td><td class="r">${fmtN(it.q)}</td><td class="r">${n2(it.p)}</td><td class="r">${n2(ft)}</td><td class="r">${P_.fobU?fmtN(ft/(P_.fobU-(+f.ajuste||0))*100,0)+'%':'—'}</td><td class="r">${n2(vu)}</td><td class="r"><b>${fmtCLP(cc)}</b></td><td class="r">${fmtCLP(cc*(+it.q||0))}</td></tr>`}).join('')}
    </tbody></table></div></div>`;
  // 7 ventas por portal
  const pk=fichaPortal, pp=f.portales[pk];
  const filas=f.items.map(it=>{const cd=(+it.p||0)*(fUse.factor||0)*tcUse, cnn=cd/(1-nn/100);
    const pv=f.precios[it.sku]?.[pk]??null, neto=pv?pv/1.19:null, com=neto?neto*pp.com/100:null, vn=neto?neto-com:null;
    const env=f.envio[it.sku]?.[pk]??pp.envio, mg=vn?(vn-cnn)/vn:null, mge=vn?(vn-cnn-env)/vn:null, mgd=neto?(neto-cd)/neto:null;
    return {it,cd,cnn,pv,neto,com,vn,env,mg,mge,mgd,ut:vn!=null?(vn-cnn-env)*(+it.q||0):null}});
  const tv=filas.reduce((s,x)=>s+(x.vn||0)*(+x.it.q||0),0), tu=filas.reduce((s,x)=>s+(x.ut||0),0);
  const resumenPortales=PORTALES.map(([k,l])=>{const p=f.portales[k];let v=0,u=0;f.items.forEach(it=>{const cd=(+it.p||0)*(fUse.factor||0)*tcUse,cnn=cd/(1-nn/100),pv=f.precios[it.sku]?.[k];if(!pv)return;const vn=pv/1.19*(1-p.com/100),env=f.envio[it.sku]?.[k]??p.envio;v+=vn*(+it.q||0);u+=(vn-cnn-env)*(+it.q||0)});return {k,l,v,u,m:v?u/v:null}});
  const s7=`<div class="panel"><header><h3><span class="stepn">7</span>Proyección de ventas por portal</h3><span class="sub">Precio de venta, comisión y envío editables · costo NN = costo directo ÷ (1 − margen Netnow)</span></header>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
     <label style="max-width:170px">Margen Netnow (%)${inp('margenNN',nn)}</label>
     <div class="seg" id="f-portal">${PORTALES.map(([k,l])=>`<button aria-pressed="${k===pk}" data-portal="${k}">${l}</button>`).join('')}</div>
     <label style="max-width:150px">Comisión ${PORTALES.find(x=>x[0]===pk)[1]} (%)${inp(`portales.${pk}.com`,pp.com)}</label>
     <label style="max-width:150px">Envío por defecto (CLP)${inp(`portales.${pk}.envio`,pp.envio)}</label>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Modelo</th><th class="r">Costo directo neto</th><th class="r">MG Netnow</th><th class="r">Costo NN</th><th class="r">Precio venta</th><th class="r">Precio neto</th><th class="r">MG directo</th><th class="r">Comisión</th><th class="r">Envío</th><th class="r">Venta neta</th><th class="r">MG retail</th><th class="r">MG tras envío</th><th class="r">Utilidad (${'todas las u.'})</th></tr></thead><tbody>
    ${filas.map(x=>`<tr><td><b class="mono">${x.it.sku}</b><div class="hint">${x.it.nombre||''}</div></td><td class="r">${fmtCLP(x.cd)}</td><td class="r">${nn}%</td><td class="r">${fmtCLP(x.cnn)}</td>
      <td class="r">${inp(`precios.${x.it.sku}.${pk}`,x.pv,{w:'110px',ph:'precio'})}</td><td class="r">${x.neto?fmtCLP(x.neto):'—'}</td><td class="r">${x.mgd!=null?fmtN(x.mgd*100,1)+'%':'—'}</td>
      <td class="r">${x.com!=null?fmtCLP(x.com):'—'}</td><td class="r">${inp(`envio.${x.it.sku}.${pk}`,x.env,{w:'90px'})}</td><td class="r">${x.vn!=null?fmtCLP(x.vn):'—'}</td>
      <td class="r" style="color:${x.mg==null?'':x.mg<0.15?'var(--bad)':x.mg<0.3?'var(--warn)':'var(--ok)'}"><b>${x.mg!=null?fmtN(x.mg*100,1)+'%':'—'}</b></td><td class="r">${x.mge!=null?fmtN(x.mge*100,1)+'%':'—'}</td><td class="r">${x.ut!=null?fmtCLP(x.ut):'—'}</td></tr>`).join('')}
    <tr class="tot"><td colspan="9">Si toda la importación se vende en ${PORTALES.find(x=>x[0]===pk)[1]}</td><td class="r">${fmtCLP(tv)}</td><td class="r">${tv?fmtN((tu)/tv*100,1)+'%':''}</td><td></td><td class="r"><b>${fmtCLP(tu)}</b></td></tr>
    </tbody></table></div>
    <div class="kv" style="margin-top:12px">${resumenPortales.map(r=>`<div><span>${r.l}</span><b>${r.m!=null?fmtN(r.m*100,1)+'% margen':'sin precios'}</b><span>${fmtCLP(r.u)} utilidad</span></div>`).join('')}</div>
    <p class="hint" style="margin:8px 0 0">Comisiones Retail.cl (pasarela) 3,5% y Walmart 12% son supuestos editables; Mercado Libre 17% y Falabella 12% vienen de tu Sheets. MG retail = (venta neta − costo NN) ÷ venta neta.</p></div>`;
  const acciones=fichaNueva?`<button class="btn" id="f-cancel">Cancelar</button><button class="btn primary" id="f-save">Crear importación</button>`
    :`<button class="btn" id="f-back">← Importaciones</button>${eObj?'<button class="btn" id="f-hitos">Hitos y documentos</button>':''}${eObj&&eObj.estado==='En cotización'?'<button class="btn primary" id="f-confirm">Confirmar orden</button>':''}`;
  return `<section class="view">
   <div class="head"><div>${head}</div><div class="actions">${acciones}</div></div>
   <div class="kpis">
    <div class="kpi"><span class="eyebrow">FOB</span><span class="v num">${fmtUSD(P_.fobU)}</span><span class="d">${fmtN(f.items.reduce((s,i)=>s+(+i.q||0),0))} unidades · ${f.incoterm}</span></div>
    <div class="kpi"><span class="eyebrow">Factor proyectado</span><span class="v num">${P_.factor?fmtN(P_.factor,3):'—'}</span><span class="d">T/C ${fmtN(f.projTc==='hoy'?f.tcHoy:f.tcAduana,2)}</span></div>
    <div class="kpi"><span class="eyebrow">Factor real</span><span class="v num" style="color:${realOk?'var(--ok)':'var(--ink-3)'}">${realOk&&R.factor?fmtN(R.factor,3):'—'}</span><span class="d">${realOk?'Costeo cerrado':`Faltan ${R.faltan} campos`}</span></div>
    <div class="kpi"><span class="eyebrow">Inversión total (sin IVA)</span><span class="v num">${fmtCLP(realOk?R.totC:P_.totC)}</span><span class="d">${realOk?'Real':'Proyectada'}</span></div>
   </div>
   ${s1}${s2}${s3}${s4}${s5}${s6}${s7}
  </section>`;
}
function setPath(o,path,val){const ks=path.split('.');let x=o;for(let i=0;i<ks.length-1;i++){const k=ks[i];if(x[k]==null)x[k]=/^\d+$/.test(ks[i+1])?[]:{};x=x[k]}x[ks[ks.length-1]]=val}
function bindFicha(){
  const f=FICHA[fichaId]; if(!f) return;
  const keep=fn=>{const y=window.scrollY;fn();render();window.scrollTo(0,y)};
  document.querySelectorAll('.fin').forEach(el=>el.onchange=()=>keep(()=>{
    const p=el.dataset.p, raw=el.value, num=el.type==='number'?(raw===''?null:+raw):raw;
    if(p==='base'){const b=fichaDe(raw);const nf=JSON.parse(JSON.stringify(b));Object.assign(nf,{id:f.id,ref:f.ref,base:raw,tcReal:null,real:{fobClp:null,flete:null,seguro:null,ivaClp:null,g:G0()}});FICHA.__nueva=nf;return}
    setPath(f,p,num);
    const tcP=f.projTc==='hoy'?f.tcHoy:f.tcAduana;
    const m=p.match(/^(proj|real)\.(flete|seguro)\.(0|1)$/);
    if(m){const tc=m[1]==='proj'?tcP:(f.tcReal||f.tcHoy);const arr=f[m[1]][m[2]];if(arr){if(m[3]==='0'&&arr[0]!=null)arr[1]=Math.round(arr[0]*tc);if(m[3]==='1'&&arr[1]!=null)arr[0]=Math.round(arr[1]/tc*100)/100}}
    if(p==='projTc'||p==='tcAduana'||p==='tcHoy'){['flete','seguro'].forEach(k=>{const a=f.proj[k];if(a&&a[0]!=null)a[1]=Math.round(a[0]*(f.projTc==='hoy'?f.tcHoy:f.tcAduana))})}
    if(p==='linea'&&NN_DEF[num]) f.margenNN=NN_DEF[num];
    if(p.startsWith('items.')&&p.endsWith('.sku')){const it=f.items[+p.split('.')[1]];if(!f.precios[it.sku])f.precios[it.sku]=Object.fromEntries(PORTALES.map(([k])=>[k,PVP_REF[it.sku]||null]))}
    if(!fichaNueva&&EMB.some(e=>e.id===f.id)) guardarLuego(f.id);
  }));
  const auto=()=>{if(!fichaNueva&&EMB.some(e=>e.id===f.id)) guardarLuego(f.id)};
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>keep(()=>{f.items.splice(+b.dataset.del,1);auto()}));
  const add=$('#f-add'); if(add) add.onclick=()=>keep(()=>f.items.push({sku:'',nombre:'',q:0,p:0}));
  document.querySelectorAll('[data-portal]').forEach(b=>b.onclick=()=>keep(()=>{fichaPortal=b.dataset.portal}));
  const pi=$('#f-pi'); if(pi) pi.onclick=()=>{piDrawer();piDestino=fichaId};
  const back=$('#f-back'); if(back) back.onclick=()=>{cur='importaciones';render()};
  const hit=$('#f-hitos'); if(hit) hit.onclick=()=>embDrawer(f.id);
  const cf=$('#f-confirm'); if(cf) cf.onclick=()=>{const e=EMB.find(x=>x.id===f.id);e.estado='En producción';e.pedido=HOY_S;materializarPagos(e,true);guardar(f.id,'Confirmar orden');toast(`${f.id} confirmada: pasa a "En producción" y el anticipo entra al flujo de caja.`);render()};
  const cancel=$('#f-cancel'); if(cancel) cancel.onclick=()=>{delete FICHA.__nueva;cur='importaciones';render()};
  const save=$('#f-save'); if(save) save.onclick=()=>{
    const id=(f.id||'').trim();
    if(!id){toast('Ponle un N° de importación (el nombre de la carpeta).');return}
    if(EMB.some(e=>e.id===id)||FICHA[id]){toast('Ya existe una importación con ese número.');return}
    const P_=costeo(f,'proj');
    const nf=JSON.parse(JSON.stringify(f)); delete nf.base; FICHA[id]=normFicha(id,nf); delete FICHA.__nueva;
    EMB.push({id,linea:f.linea,prov:f.proveedor,via:f.via,tipo:/aéreo/i.test(f.via)?'Aéreo':f.via==='Local'?'Local':'Marítimo',u:f.items.reduce((s,i)=>s+(+i.q||0),0),estado:'En cotización',pedido:HOY_S,fob:P_.fobU,flete:P_.fl?.[0]||0,anticipo:f.anticipo,balance:f.balance,ref:f.ref,desc:f.items.map(i=>i.nombre).filter(Boolean).slice(0,3).join(', '),pol:f.pol,pagos:[],docs:{PI:0,Invoice:0,'Packing list':0,BL:0,DIN:0,Swift:0,'Set importación':0}});
    materializarPagos(EMB.find(e=>e.id===id),true); crearCarpeta(id);
    fichaId=id; fichaNueva=false; guardar(id,'Crear importación'); toast(`${id} creada en cotización. Confirma la orden cuando el proveedor acepte.`); render(); window.scrollTo(0,0);
  };
}
let piDestino=null;

/* ---------- GUARDADO EN EL SHEETS ---------- */
let SAVE_ST={st:'',msg:''}, colaGuardado=Promise.resolve(), timersGuardado={};
function estadoGuardado(st,msg=''){SAVE_ST={st,msg};pintarGuardado();if(st==='error')toast('No se pudo guardar: '+msg)}
function pintarGuardado(){const el=$('#save-st');if(!el)return;
  el.textContent={guardando:'Guardando…',ok:'Guardado ✓',error:'Error al guardar'}[SAVE_ST.st]||'';
  el.style.color=SAVE_ST.st==='error'?'var(--bad)':SAVE_ST.st==='ok'?'var(--ok)':'';el.title=SAVE_ST.msg||''}
// Lleva los datos editados en la ficha a la importación (lo que se ve en la tabla).
function sincFicha(id){
  const e=EMB.find(x=>x.id===id), f=FICHA[id]; if(!e||!f) return;
  const c=costeo(f,'proj'), R=costeo(f,'real');
  Object.assign(e,{ref:f.ref||e.ref,linea:f.linea||e.linea,prov:f.proveedor||e.prov,via:f.via||e.via,pol:f.pol||e.pol,anticipo:f.anticipo,balance:f.balance,
    u:f.items.reduce((s,i)=>s+(+i.q||0),0)||e.u,fob:c.fobU||e.fob,flete:(f.real.flete?.[0])||(c.fl?.[0])||e.flete});
  e.tipo=/aéreo/i.test(e.via)?'Aéreo':e.via==='Local'?'Local':'Marítimo';
  const fa=FACT.find(x=>x.id===id)||(FACT.push({id,linea:e.linea,prov:e.prov,fecha:e.pedido,proy:null,real:null,q:'validar'}),FACT[FACT.length-1]);
  fa.proy=c.factor?Math.round(c.factor*10000)/10000:fa.proy;
  if(R.factor&&!R.faltan){fa.real=Math.round(R.factor*10000)/10000;fa.q=fa.q==='validar'||fa.q==='cot'?'final':fa.q;e.factor=fa.real}
}
function guardar(id,accion){
  if(!EDITOR){toast('Tu cuenta tiene acceso de solo lectura: el cambio no se guardó.');return Promise.resolve()}
  clearTimeout(timersGuardado[id]); delete timersGuardado[id];
  sincFicha(id); estadoGuardado('guardando');
  colaGuardado=colaGuardado.then(()=>Store.guardarImportacion(id,accion)).then(()=>estadoGuardado('ok')).catch(err=>{if(err.message!=='recargado')estadoGuardado('error',err.message);else{toast('Datos recargados desde el Sheets.');render()}});
  return colaGuardado;
}
function guardarLuego(id){clearTimeout(timersGuardado[id]);estadoGuardado('guardando');timersGuardado[id]=setTimeout(()=>guardar(id,'Edición'),1200)}
window.addEventListener('beforeunload',ev=>{if(Object.keys(timersGuardado).length||SAVE_ST.st==='guardando'){ev.preventDefault();ev.returnValue=''}});

// Deja escrito en BD_Pagos el calendario estimado (anticipo, balance, flete, IVA, agencia, bodega).
// regenerar=true reemplaza los pagos "Estimado" (p. ej. al confirmar la orden con nueva fecha); los reales se mantienen.
function materializarPagos(e,regenerar){
  if(!e) return;
  const prev=PAGOS[e.id];
  if(prev&&!regenerar) return;
  const reales=(prev||[]).filter(p=>p[6]!=='Estimado');
  delete PAGOS[e.id];
  const est=pagosEmb(e).filter(p=>p.fuente==='Estimado').filter(p=>!reales.some(r=>r[1]===p.cat&&r[2]===p.concepto));
  PAGOS[e.id]=[...reales,...est.map(p=>[p.fecha,p.cat,p.concepto,p.mon,Math.round(p.monto*100)/100,p.tc,'Estimado',1,null,''])].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
}
async function crearCarpeta(id){
  const e=EMB.find(x=>x.id===id); if(!e||e.carpetaId) return;
  try{
    const raiz=CFG.carpeta_raiz_id||CONFIG.CARPETA_RAIZ_ID;
    const linea=await G.buscarCarpeta(e.linea,raiz)||await G.crearCarpeta(e.linea,raiz);
    const d=new Date();const nombre=`${id} (${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()})`;
    const c=await G.crearCarpeta(nombre,linea.id);
    e.carpeta=nombre; e.carpetaId=c.id; guardar(id,'Crear carpeta Drive'); toast(`Carpeta "${nombre}" creada en Drive / ${e.linea}.`);
  }catch(err){toast('No se pudo crear la carpeta en Drive: '+err.message)}
}
const faltanSets=()=>EMB.filter(e=>e.estado==='Recibido'&&!e.docs['Set importación']);
function pendientesValidacion(){
  const out=[];
  FACT.filter(f=>f.q==='validar'||f.q==='parcial').forEach(f=>out.push(`${f.id}: costeo real ${f.q==='parcial'?'incompleto':'sin validar'}${f.nota?' — '+f.nota:''}.`));
  faltanSets().forEach(e=>out.push(`${e.id}: falta el set de importación de Grace en la carpeta.`));
  EMB.filter(e=>e.alerta).forEach(e=>out.push(`${e.id}: ${e.alerta}`));
  return out;
}

/* ---------- CORREOS ---------- */
let correoFiltro='por asignar';
function correosView(){
  const grupo=c=>c.estado==='archivado'?'asignado':c.estado;
  const lista=CORREOS.filter(c=>correoFiltro==='todos'||grupo(c)===correoFiltro);
  const cnt=k=>CORREOS.filter(c=>grupo(c)===k).length;
  return `<section class="view"><div class="head"><div><h2 style="font-size:22px;margin-top:4px">Correos</h2>
    <p>Órdenes, PI, pagos, Swift, DIN y avisos de arribo de proveedores y de Grace. Los que el motor no pudo asociar a una importación quedan "por asignar"; al asignarlos, sus adjuntos se guardan en la carpeta en la próxima pasada.</p></div></div>
   <div class="seg" id="cf" style="margin-bottom:12px">${[['por asignar','Por asignar'],['asignado','Asignados'],['ignorado','Ignorados'],['todos','Todos']].map(([k,l])=>`<button aria-pressed="${k===correoFiltro}" data-cf="${k}">${l}${k!=='todos'?` (${cnt(k)})`:''}</button>`).join('')}</div>
   <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>De</th><th>Asunto</th><th>Tipo</th><th>Adjuntos</th><th>Importación</th></tr></thead><tbody>
   ${lista.length?lista.slice(0,300).map(c=>`<tr><td>${fmtD(c.fecha)}</td><td class="hint">${esc(c.de)}</td><td><a href="${c.link}" target="_blank" rel="noopener">${esc(c.asunto)}</a></td><td><span class="chip">${esc(c.tipo)}</span></td><td class="hint">${esc(c.adjuntos)}</td>
     <td><select data-th="${c.thread_id}"><option value="">${c.estado==='ignorado'?'Ignorado':'— Sin asignar —'}</option>${EMB.map(e=>`<option ${e.id===c.importacion?'selected':''}>${e.id}</option>`).join('')}</select></td></tr>`).join('')
     :`<tr><td colspan="6" style="text-align:center;color:var(--ink-3);padding:24px">${CORREOS.length?'Sin correos en esta vista.':'Aún no hay correos: instala el motor en Apps Script (ver README) y espera la primera pasada.'}</td></tr>`}
   </tbody></table></div></div></section>`;
}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function bindCorreos(){
  document.querySelectorAll('[data-cf]').forEach(b=>b.onclick=()=>{correoFiltro=b.dataset.cf;render()});
  document.querySelectorAll('select[data-th]').forEach(s=>s.onchange=async()=>{
    try{estadoGuardado('guardando');await Store.asignarCorreo(s.dataset.th,s.value);estadoGuardado('ok');toast(s.value?`Correo asignado a ${s.value}.`:'Correo marcado como ignorado.');render()}
    catch(err){estadoGuardado('error',err.message)}});
}

/* ---------- SOLO LECTURA ---------- */
function soloLectura(root){
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(el.matches('[data-fk],#q,#inc,#cf *,input[type=search]')) return;
    el.disabled=true;
  });
  root.querySelectorAll('#nueva,#subir-pi,#carga-nueva,#carga-pi,#f-save,#f-confirm,#f-add,#f-pi,[data-del],button[type=submit],#cot-ok,#cot-desc').forEach(el=>el.hidden=true);
}

/* ---------- INICIO ---------- */
function pantalla(html){$('#main').innerHTML=`<section class="view" style="max-width:640px;margin:8vh auto">${html}</section>`;$('#tabs').innerHTML=''}
async function recargar(){
  try{await Store.cargar();toast('Datos actualizados desde el Sheets.');render()}catch(err){toast('No se pudo leer el Sheets: '+err.message)}
}
function salir(){G.logout();location.reload()}
async function dolarDelDia(){
  try{const r=await fetch('https://mindicador.cl/api/dolar');const j=await r.json();const v=j.serie?.[0]?.valor;if(v>500&&v<2000){TC=v;CFG.tc_fuente='Dólar observado '+fmtD(j.serie[0].fecha.slice(0,10))}}catch(e){}
}
async function entrar(){
  pantalla('<div class="panel"><h2>Cargando…</h2><p class="hint">Leyendo el Sheets de importaciones.</p></div>');
  try{
    USUARIO=await G.usuario();
    try{EDITOR=await G.puedeEditar()}catch(err){
      const api=/has not been used|is disabled|accessNotConfigured/i.test(err.message), scope=!G.permisosOk()||/insufficient|scope/i.test(err.message);
      if(api||scope){pantalla(`<div class="panel"><h2>Falta un permiso de Google</h2><p>${api?'La API de Google Drive o de Sheets no está activada en el proyecto de Google Cloud "Importaciones 2ebox". Actívala en APIs y servicios → Biblioteca y vuelve a entrar.':'Al entrar no se marcaron todos los permisos (ver y editar Sheets y Drive). Vuelve a entrar y marca todas las casillas.'}</p><p class="hint">Detalle: ${esc(err.message)}</p><button class="btn primary" onclick="salir()">Volver a entrar</button></div>`);return}
      if(err.status===404||err.status===403){pantalla(`<div class="panel"><h2>Sin acceso</h2><p>La cuenta <b>${esc(USUARIO.email)}</b> no tiene acceso al Sheets IMPORTACIONES 2EBOX. Pide a Jorge que lo comparta contigo (lector para ver, editor para editar).</p><p class="hint">Detalle: ${esc(err.message)}</p><button class="btn" onclick="salir()">Entrar con otra cuenta</button></div>`);return}
      throw err}
    const falt=await Store.faltantes();
    if(falt.length&&window.ENTORNO==='QA'){
      pantalla(`<div class="panel" style="display:grid;gap:12px"><span class="eyebrow">Ambiente QA</span><h2>Sin datos de prueba</h2><p>Este artifact todavía no tiene su copia de datos. Cárgala desde la semilla guardada en el artifact.</p><div><button class="btn primary" id="qa-cargar">Cargar datos de prueba</button></div><div id="ini-st" class="hint"></div></div>`);
      $('#qa-cargar').onclick=async()=>{try{await G.reiniciar();await entrar()}catch(err){$('#ini-st').textContent='Error: '+err.message}};
      return;
    }
    if(falt.length){
      if(!EDITOR){pantalla(`<div class="panel"><h2>Base en preparación</h2><p>Todavía no se crean las pestañas de la app en el Sheets. Vuelve a intentar más tarde.</p></div>`);return}
      pantalla(`<div class="panel" style="display:grid;gap:12px"><span class="eyebrow">Primera vez</span><h2>Crear la base en el Sheets</h2>
        <p>Faltan estas pestañas en IMPORTACIONES 2EBOX: <b>${falt.join(', ')}</b>. Se crean vacías, o con los datos validados si eliges el archivo <span class="mono">semilla_app.json</span> (carpeta Plan de Compras/data).</p>
        <label class="drop"><input type="file" id="semilla" accept=".json" hidden><b>Elegir semilla_app.json</b><span class="hint">Las pestañas que ya existen no se tocan.</span></label>
        <div style="display:flex;gap:10px"><button class="btn" id="vacia">Crear vacías</button></div><div id="ini-st" class="hint"></div></div>`);
      const crear=async sem=>{$('#ini-st').textContent='Creando pestañas…';try{await Store.inicializar(sem,falt);await entrar()}catch(err){$('#ini-st').textContent='Error: '+err.message}};
      $('#semilla').onchange=ev=>{const fr=new FileReader();fr.onload=()=>{try{crear(JSON.parse(fr.result))}catch(e){$('#ini-st').textContent='El archivo no es un JSON válido.'}};fr.readAsText(ev.target.files[0])};
      $('#vacia').onclick=()=>crear(null);
      return;
    }
    await Promise.all([Store.cargar(),dolarDelDia()]);
    try{const t=localStorage.getItem('pc-tab');if(t&&TABS.some(x=>x[0]===t))cur=t}catch(e){}
    render();
  }catch(err){
    pantalla(`<div class="panel"><h2>No se pudo cargar</h2><p class="err">${esc(err.message)}</p><button class="btn primary" onclick="location.reload()">Reintentar</button> <button class="btn" onclick="salir()">Salir</button></div>`);
  }
}
function boot(){
  if(window.ENTORNO==='QA'){pantalla('<div class="panel"><h2>Cargando QA…</h2></div>');G.init().then(entrar).catch(err=>pantalla(`<div class="panel"><h2>No se pudo abrir QA</h2><p class="err">${esc(err.message)}</p></div>`));return}
  if(!window.google?.accounts?.oauth2){setTimeout(boot,150);return}
  G.init();
  if(G.conectado()){entrar();return}
  pantalla(`<div class="panel" style="display:grid;gap:14px;text-align:center;padding:36px"><h2 style="font-size:24px">Importaciones · retail.cl</h2>
    <p style="color:var(--ink-2)">Plan de compras, costeo y flujo de caja de las importaciones de 2ebox. Entra con tu cuenta de Google de la empresa.</p>
    <div><button class="btn primary" id="login" style="font-size:15px;padding:10px 22px">Entrar con Google</button></div>
    <p class="hint">Verás y editarás lo mismo que tu cuenta puede ver y editar en el Sheets IMPORTACIONES 2EBOX.</p><div id="login-err" class="err" hidden></div></div>`);
  $('#login').onclick=async()=>{try{await G.login();entrar()}catch(err){const e=$('#login-err');e.hidden=false;e.textContent='No se pudo entrar: '+err.message}};
}
boot();
