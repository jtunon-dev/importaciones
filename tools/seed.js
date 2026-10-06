/* Genera el archivo semilla (filas para las pestañas BD_*) a partir de los datos validados del mockup.
   Uso: node tools/seed.js <ruta mockup plan-compras.html> <salida.json>
   La salida contiene datos del negocio: guárdala fuera del repositorio. */
const fs = require('fs');
require('../js/schema.js');
const [, , mockup, salida] = process.argv;
const html = fs.readFileSync(mockup, 'utf8');
let js = html.match(/<script>([\s\S]*?)<\/script>\s*$/)[1];
js = js.replace(/\/\* ---------- INICIO[\s\S]*$/, '');
const doc = { querySelector: () => ({}), querySelectorAll: () => [], addEventListener: () => {} };
const m = new Function('document', 'localStorage', 'window', js + ';return {EMB,PAGOS,FICHA,FACT,SKUS,P,PORTAL_DEF,NN_DEF,TC,MESES,ITEMS_EXTRA,normFicha}')(doc, { getItem: () => null, setItem: () => {} }, {});

const v = x => x == null || (typeof x === 'number' && !isFinite(x)) ? '' : x;
const fila = (tab, o) => SCHEMA[tab].map(k => v(o[k]));
const out = Object.fromEntries(Object.keys(SCHEMA).map(t => [t, []]));
const AHORA = new Date().toISOString();

const embs = m.EMB.filter(e => !(e.cot && e.cot.ejemplo));
embs.forEach(e => {
  const f = m.FICHA[e.id], fa = m.FACT.find(x => x.id === e.id) || {};
  out.BD_Importaciones.push(fila('BD_Importaciones', {
    id: e.id, linea: e.linea, proveedor: e.prov, estado: e.estado, ref: e.ref, ref_klog: e.klog, descripcion: e.desc, tipo: e.tipo, via: e.via, pol: f?.pol ?? e.pol,
    incoterm: f?.incoterm, unidades: e.u, fob_usd: e.fob, flete_usd: e.flete, pedido: e.pedido, zarpe: e.zarpe, zarpe_est: e.zarpeEst, eta_inicial: e.etaIni, eta: e.eta,
    eta_est: e.etaEst, din: e.din, din_est: e.dinEst, din_n: e.dinN, bodega: e.bodega, bodega_est: e.bodegaEst, cd_fuente: e.cdFuente, set_n: e.setN, carpeta: e.carpeta,
    pestana: e.pest, anticipo_pct: f?.anticipo ?? e.anticipo, balance: f?.balance ?? e.balance, tc_hoy: f?.tcHoy, tc_aduana: f?.tcAduana, tc_real: f?.tcReal,
    tc_pagos: e.tc, iva_usd: e.iva, proyectar_con: f?.projTc, ajuste_usd: f?.ajuste, margen_nn: f?.margenNN, portales_json: f ? JSON.stringify(f.portales) : '',
    factor_proy: fa.proy, factor_real: fa.real ?? e.factor, factor_calidad: fa.q, factor_nota: fa.nota, alerta: e.alerta,
    actualizado: AHORA, actualizado_por: 'carga inicial (Sheets + DIN + sets + correos)'
  }));
  if (f) {
    const col = (nombre, c, real) => fila('BD_Costeo', { id: e.id, columna: nombre, fob_clp: real ? c.fobClp : '', flete_usd: c.flete?.[0], flete_clp: c.flete?.[1],
      seguro_usd: c.seguro?.[0], seguro_clp: c.seguro?.[1], iva_clp: real ? c.ivaClp : '', respaldo: real && f.set ? 'Set ' + f.set : '', ...c.g });
    out.BD_Costeo.push(col('PROYECTADO', f.proj, false), col('REAL', f.real, true));
  }
  const items = f ? f.items : (m.ITEMS_EXTRA[e.id] || []).map(x => ({ sku: x[0], nombre: x[1], q: x[2], p: x[3] }));
  items.forEach(it => {
    const pr = f?.precios?.[it.sku] || {}, en = f?.envio?.[it.sku] || {};
    out.BD_Productos.push(fila('BD_Productos', { id: e.id, sku: it.sku, nombre: it.nombre, unidades: it.q, fob_unit_usd: it.p, pvp_shopify: pr.shopify, pvp_meli: pr.meli,
      pvp_fala: pr.fala, pvp_walmart: pr.walmart, envio_shopify: en.shopify, envio_meli: en.meli, envio_fala: en.fala, envio_walmart: en.walmart }));
  });
  (m.PAGOS[e.id] || []).forEach((p, i) => out.BD_Pagos.push(fila('BD_Pagos', { pago_id: e.id.replace(/\s+/g, '') + '-' + String(i + 1).padStart(2, '0'), importacion: e.id,
    fecha: p[0], tipo: p[1], concepto: p[2], moneda: p[3], monto: p[4], tc: p[5], fuente: p[6], fecha_estimada: p[7] ? 'SI' : 'NO', creado_por: 'carga inicial' })));
  Object.entries(e.docs || {}).forEach(([t, ok]) => { if (ok) out.BD_Documentos.push(fila('BD_Documentos', { importacion: e.id, tipo: t, archivo: '(registrado antes del motor)', modificado: '' })); });
});
m.SKUS.forEach(s => out.BD_Stock.push(fila('BD_Stock', { linea: s.linea, sku: s.sku, nombre: s.nombre, stock: s.stock, valor_clp: s.valor, fob_usd: s.fob,
  nuevo: s.nuevo ? 'SI' : 'NO', descontinuado: s.desc ? 'SI' : 'NO', ...Object.fromEntries((s.ventas || []).map((x, i) => ['v' + String(i + 1).padStart(2, '0'), x])) })));
[
  ['tc_ref', m.TC, 'T/C de referencia para valorizar USD sin T/C conocido (la app intenta usar el dólar observado del día)'],
  ['meses_stock', m.MESES.join(','), 'Meses de las columnas v01..v12 de BD_Stock'],
  ['stock_fecha', '2026-10-05', 'Fecha del corte de stock de Defontana'],
  ['supuestos_json', JSON.stringify(m.P), 'Lead time, stock de seguridad, revisión, MOQ por línea'],
  ['portales_json', JSON.stringify(m.PORTAL_DEF), 'Comisión y envío por defecto por portal'],
  ['margen_nn_json', JSON.stringify(m.NN_DEF), 'Margen Netnow por línea (%)'],
  ['carpeta_raiz_id', '147LYsW2tFii-nto1MzMpbeOZQWn8fGso', 'Carpeta padre de Chimeneas / Telones / Reolink'],
  ['gmail_consulta', 'newer_than:30d (subject:("new order" OR "nueva orden" OR orden OR order OR proforma OR PI OR swift OR transferencia OR DIN OR arribo OR "B/L" OR invoice) OR from:grace.hinostroza@netnow.cl)', 'Búsqueda que usa el motor en Gmail']
].forEach(([clave, valor, nota]) => out.BD_Config.push([clave, valor, nota]));

fs.writeFileSync(salida, JSON.stringify(out));
console.log(Object.entries(out).map(([k, r]) => `${k}: ${r.length}`).join('\n'));
