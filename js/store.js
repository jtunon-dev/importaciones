/* Datos de la app: se leen de las pestañas BD_* del Sheets y se guardan por importación.
   Estas variables globales son las que usan las vistas (app.js). */
let EMB = [], PAGOS = {}, FICHA = {}, FACT = [], SKUS = [], MESES = [], TRANSITO = {}, CAJA_COMP = [], DOCS = {}, CORREOS = [];
let P = {}, PORTAL_DEF = {}, NN_DEF = {}, TC = 935, CFG = {};
let USUARIO = null, EDITOR = false, SHEET_IDS = {}, CARGADO_EN = null;
const VERSION_FILA = {};
const HEADERS = {};      // encabezados reales de cada pestaña BD_* (la app escribe en ese orden) // id → 'actualizado' leído, para detectar cambios de otro usuario

const ISO = d => d.toISOString().slice(0, 10);
const HOY = new Date(); HOY.setHours(12, 0, 0, 0);
const HOY_S = ISO(HOY);

const Store = (() => {
  const TABS = Object.keys(SCHEMA);
  const FECHAS = {
    BD_Importaciones: new Set(['pedido', 'zarpe', 'zarpe_est', 'eta_inicial', 'eta', 'eta_est', 'din', 'din_est', 'bodega', 'bodega_est']),
    BD_Pagos: new Set(['fecha']), BD_Correos: new Set(['fecha'])
  };
  const vacio = v => v === '' || v == null;
  const num = v => vacio(v) ? null : typeof v === 'number' ? v : (isFinite(+String(v).replace(',', '.')) ? +String(v).replace(',', '.') : null);
  const serialAIso = n => ISO(new Date(Math.round((n - 25569) * 864e5) + 12 * 36e5));
  function fecha(v) {
    if (vacio(v)) return null;
    if (typeof v === 'number') return serialAIso(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return s;
  }
  const json = v => { if (vacio(v)) return null; try { return JSON.parse(v); } catch (e) { return null; } };
  function objetos(tab, values) {
    if (!values || !values.length) return [];
    const h = values[0].map(x => String(x).trim());
    return values.slice(1).filter(r => r.some(x => !vacio(x))).map((r, i) => {
      const o = { _fila: i + 2 };
      const fs = FECHAS[tab];
      h.forEach((k, j) => { o[k] = fs && fs.has(k) ? fecha(r[j]) : (r[j] === undefined ? '' : r[j]); });
      return o;
    });
  }

  /* ---------- Sheets → modelo ---------- */
  function construir(T) {
    CFG = Object.fromEntries(T.BD_Config.map(r => [r.clave, r.valor]));
    P = json(CFG.supuestos_json) || {};
    PORTAL_DEF = json(CFG.portales_json) || { shopify: { com: 3.5, envio: 0 }, meli: { com: 17, envio: 9551 }, fala: { com: 12, envio: 4244 }, walmart: { com: 12, envio: 0 } };
    NN_DEF = json(CFG.margen_nn_json) || { Chimeneas: 20, Telones: 15, Reolink: 5 };
    TC = num(CFG.tc_ref) || 935;
    MESES = String(CFG.meses_stock || '').split(',').map(s => s.trim()).filter(Boolean);

    DOCS = {};
    T.BD_Documentos.forEach(d => { (DOCS[d.importacion] = DOCS[d.importacion] || []).push(d); });
    CORREOS = T.BD_Correos.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    PAGOS = {}; CAJA_COMP = [];
    T.BD_Pagos.forEach(p => {
      const est = /^s/i.test(String(p.fecha_estimada));
      (PAGOS[p.importacion] = PAGOS[p.importacion] || []).push([p.fecha, p.tipo, p.concepto, p.moneda, num(p.monto), num(p.tc), p.fuente, est ? 1 : 0, p.pago_id, p.respaldo]);
    });
    Object.values(PAGOS).forEach(l => l.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

    const cost = {}, prods = {};
    T.BD_Costeo.forEach(c => { (cost[c.id] = cost[c.id] || {})[String(c.columna).toUpperCase().startsWith('P') ? 'proj' : 'real'] = c; });
    T.BD_Productos.forEach(p => { (prods[p.id] = prods[p.id] || []).push(p); });

    EMB = []; FICHA = {}; FACT = []; ITEMS_EXTRA = {};
    T.BD_Importaciones.forEach(r => {
      if (vacio(r.id)) return;
      const id = String(r.id);
      VERSION_FILA[id] = String(r.actualizado || '');
      const docs = Object.fromEntries(TIPOS_DOC.map(t => [t, (DOCS[id] || []).some(d => d.tipo === t) ? 1 : 0]));
      const pr = (PAGOS[id] || []).filter(p => p[1] === 'prov');
      const e = {
        id, linea: r.linea, prov: r.proveedor, estado: r.estado || 'En cotización', ref: r.ref || null, klog: r.ref_klog || null,
        desc: r.descripcion || '', tipo: r.tipo || (/aéreo/i.test(r.via) ? 'Aéreo' : 'Marítimo'), via: r.via || '', pol: r.pol || null,
        u: num(r.unidades), fob: num(r.fob_usd), flete: num(r.flete_usd), pedido: r.pedido, zarpe: r.zarpe, zarpeEst: r.zarpe_est,
        etaIni: r.eta_inicial, eta: r.eta, etaEst: r.eta_est, din: r.din, dinEst: r.din_est, dinN: r.din_n || null,
        bodega: r.bodega, bodegaEst: r.bodega_est, cdFuente: r.cd_fuente || null, setN: r.set_n || null,
        carpeta: r.carpeta || null, carpetaId: r.carpeta_id || null, pest: r.pestana || null,
        anticipo: num(r.anticipo_pct), balance: r.balance || null, tc: num(r.tc_pagos), iva: num(r.iva_usd), factor: num(r.factor_real),
        alerta: r.alerta || null, cot: json(r.cotizacion_json), docs, actualizadoPor: r.actualizado_por || null, actualizado: r.actualizado || null,
        pagos: pr.map(p => [p[2], p[4], p[5], p[0]])
      };
      EMB.push(e);
      if (!vacio(r.factor_calidad) || num(r.factor_proy) || num(r.factor_real))
        FACT.push({ id, linea: e.linea, prov: e.prov, fecha: e.pedido, proy: num(r.factor_proy), real: num(r.factor_real), q: r.factor_calidad || 'validar', nota: r.factor_nota || undefined });
      const c = cost[id], ps = prods[id];
      if (!c && ps) ITEMS_EXTRA[id] = ps.map(p => [String(p.sku), p.nombre, num(p.unidades), num(p.fob_unit_usd)]);
      if (c) {
        const par = (u, c2) => (num(u) == null && num(c2) == null) ? null : [num(u) || 0, num(c2) || 0];
        const g = o => Object.fromEntries(GASTOS_K.map(k => [k, o ? num(o[k]) : null]));
        const precios = {}, envio = {};
        (ps || []).forEach(p => {
          precios[p.sku] = { shopify: num(p.pvp_shopify), meli: num(p.pvp_meli), fala: num(p.pvp_fala), walmart: num(p.pvp_walmart) };
          const en = {}; ['shopify', 'meli', 'fala', 'walmart'].forEach(k => { const v = num(p['envio_' + k]); if (v != null) en[k] = v; });
          if (Object.keys(en).length) envio[p.sku] = en;
        });
        FICHA[id] = {
          ref: e.ref, incoterm: r.incoterm || 'FOB', pol: e.pol, via: e.via, tcHoy: num(r.tc_hoy) || TC, tcAduana: num(r.tc_aduana) || TC, tcReal: num(r.tc_real),
          tcProy: num(r.tc_proy), tcHoyFecha: r.tc_hoy_fecha || null,
          anticipo: num(r.anticipo_pct) ?? 30, balance: r.balance || 'embarque', projTc: r.proyectar_con || 'aduana', ajuste: num(r.ajuste_usd) || 0,
          margenNN: num(r.margen_nn) ?? undefined, portales: json(r.portales_json) || undefined, set: e.setN,
          items: (ps || []).map(p => ({ sku: String(p.sku), nombre: p.nombre, q: num(p.unidades), p: num(p.fob_unit_usd) })),
          proj: { flete: par(c?.proj?.flete_usd, c?.proj?.flete_clp), seguro: par(c?.proj?.seguro_usd, c?.proj?.seguro_clp), g: g(c?.proj) },
          real: { fobClp: num(c?.real?.fob_clp), flete: par(c?.real?.flete_usd, c?.real?.flete_clp), seguro: par(c?.real?.seguro_usd, c?.real?.seguro_clp), ivaClp: num(c?.real?.iva_clp), g: g(c?.real) },
          precios, envio
        };
      }
    });
    Object.keys(FICHA).forEach(id => normFicha(id, FICHA[id]));

    SKUS = T.BD_Stock.filter(s => !vacio(s.sku)).map(s => ({
      linea: s.linea, sku: String(s.sku), nombre: s.nombre, stock: num(s.stock) || 0, valor: num(s.valor_clp) || 0, fob: num(s.fob_usd),
      nuevo: /^s/i.test(String(s.nuevo)), desc: /^s/i.test(String(s.descontinuado)),
      ventas: /^s/i.test(String(s.nuevo)) ? null : Array.from({ length: 12 }, (_, i) => num(s['v' + String(i + 1).padStart(2, '0')]) || 0)
    }));
    // Unidades en camino: productos de importaciones en producción o en tránsito
    TRANSITO = {};
    EMB.filter(e => e.estado === 'En producción' || e.estado === 'En tránsito').forEach(e => {
      const eta = e.bodega || e.bodegaEst || e.etaEst || e.eta; if (!eta) return;
      (prods[e.id] || []).forEach(p => { const q = num(p.unidades); if (q) (TRANSITO[p.sku] = TRANSITO[p.sku] || []).push({ emb: e.id, q, eta }); });
    });
    CARGADO_EN = new Date();
  }

  const letra = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  async function cargar() {
    const r = await G.leer(TABS.map(t => t + '!A:BZ'));
    const T = {}, nuevas = [];
    TABS.forEach((t, i) => {
      const vals = r.valueRanges[i]?.values || [];
      const h = (vals[0] || []).map(x => String(x).trim());
      // Columnas nuevas del esquema que la pestaña aún no tiene: se agregan al final de la fila 1.
      const falta = SCHEMA[t].filter(k => !h.includes(k));
      if (falta.length && h.length) { nuevas.push({ range: `${t}!${letra(h.length)}1`, values: [falta] }); h.push(...falta); }
      HEADERS[t] = h.length ? h : SCHEMA[t].slice();
      T[t] = objetos(t, [HEADERS[t], ...vals.slice(1)]);
    });
    if (nuevas.length && EDITOR) { try { await G.escribir(nuevas); } catch (e) {} }
    construir(T);
  }
  // Ordena una fila (en orden de SCHEMA) según los encabezados reales de la pestaña.
  const aHeader = (t, fila) => { const h = HEADERS[t]; if (!h) return fila; const o = Object.fromEntries(SCHEMA[t].map((k, i) => [k, fila[i]])); return h.map(k => o[k] ?? ''); };

  /* ---------- modelo → Sheets ---------- */
  const v = x => x == null || (typeof x === 'number' && !isFinite(x)) ? '' : x;
  function filaImportacion(id) {
    const e = EMB.find(x => x.id === id); if (!e) return null;
    const f = FICHA[id], fa = FACT.find(x => x.id === id) || {};
    const o = {
      id, linea: e.linea, proveedor: e.prov, estado: e.estado, ref: e.ref, ref_klog: e.klog, descripcion: e.desc, tipo: e.tipo, via: e.via, pol: f?.pol ?? e.pol,
      incoterm: f?.incoterm, unidades: e.u, fob_usd: e.fob, flete_usd: e.flete, pedido: e.pedido, zarpe: e.zarpe, zarpe_est: e.zarpeEst, eta_inicial: e.etaIni,
      eta: e.eta, eta_est: e.etaEst, din: e.din, din_est: e.dinEst, din_n: e.dinN, bodega: e.bodega, bodega_est: e.bodegaEst, cd_fuente: e.cdFuente, set_n: e.setN,
      carpeta: e.carpeta, carpeta_id: e.carpetaId, pestana: e.pest, anticipo_pct: f?.anticipo ?? e.anticipo, balance: f?.balance ?? e.balance,
      tc_hoy: f?.tcHoy, tc_aduana: f?.tcAduana, tc_real: f?.tcReal, tc_proy: f?.tcProy, tc_hoy_fecha: f?.tcHoyFecha, tc_pagos: e.tc, iva_usd: e.iva, proyectar_con: f?.projTc, ajuste_usd: f?.ajuste,
      margen_nn: f?.margenNN, portales_json: f ? JSON.stringify(f.portales) : '',
      factor_proy: fa.proy, factor_real: fa.real ?? e.factor, factor_calidad: fa.q, factor_nota: fa.nota, alerta: e.alerta,
      cotizacion_json: e.cot ? JSON.stringify(e.cot) : '', actualizado: new Date().toISOString(), actualizado_por: USUARIO?.email || ''
    };
    return SCHEMA.BD_Importaciones.map(k => v(o[k]));
  }
  function filasCosteo(id) {
    const f = FICHA[id]; if (!f) return [];
    const col = (nombre, c, real) => SCHEMA.BD_Costeo.map(k => v({
      id, columna: nombre, fob_clp: real ? c.fobClp : '', flete_usd: c.flete?.[0], flete_clp: c.flete?.[1], seguro_usd: c.seguro?.[0], seguro_clp: c.seguro?.[1],
      iva_clp: real ? c.ivaClp : '', respaldo: real && f.set ? 'Set ' + f.set : '', ...c.g
    }[k]));
    return [col('PROYECTADO', f.proj, false), col('REAL', f.real, true)];
  }
  function filasProductos(id) {
    const f = FICHA[id];
    const items = f ? f.items : (ITEMS_EXTRA[id] || []).map(x => ({ sku: x[0], nombre: x[1], q: x[2], p: x[3] }));
    return items.map(it => {
      const pr = f?.precios?.[it.sku] || {}, en = f?.envio?.[it.sku] || {};
      return SCHEMA.BD_Productos.map(k => v({ id, sku: it.sku, nombre: it.nombre, unidades: it.q, fob_unit_usd: it.p,
        pvp_shopify: pr.shopify, pvp_meli: pr.meli, pvp_fala: pr.fala, pvp_walmart: pr.walmart,
        envio_shopify: en.shopify, envio_meli: en.meli, envio_fala: en.fala, envio_walmart: en.walmart }[k]));
    });
  }
  function filasPagos(id) {
    const out = [];
    (PAGOS[id] || []).forEach((p, i) => {
      if (!p[8]) p[8] = id.replace(/\s+/g, '') + '-' + Date.now().toString(36) + i;
      out.push(SCHEMA.BD_Pagos.map(k => v({ pago_id: p[8], importacion: id, fecha: p[0], tipo: p[1], concepto: p[2], moneda: p[3], monto: p[4], tc: p[5], fuente: p[6], fecha_estimada: p[7] ? 'SI' : 'NO', respaldo: p[9], creado_por: p[6] === 'Registro manual' ? (p[10] || USUARIO?.email) : '' }[k])));
    });
    return out;
  }

  async function idsHojas() {
    const m = await G.meta();
    SHEET_IDS = Object.fromEntries(m.sheets.map(s => [s.properties.title, s.properties.sheetId]));
    return SHEET_IDS;
  }
  // Reemplaza todas las filas de una importación en las pestañas indicadas (borra y vuelve a agregar).
  async function reemplazar(id, porTab) {
    const tabs = Object.keys(porTab);
    const col = { BD_Importaciones: 'A', BD_Costeo: 'A', BD_Productos: 'A', BD_Pagos: 'B' };
    const r = await G.leer(tabs.map(t => `${t}!${col[t]}:${col[t]}`));
    if (!Object.keys(SHEET_IDS).length) await idsHojas();
    const borrar = [];
    tabs.forEach((t, i) => {
      const vals = r.valueRanges[i].values || [];
      vals.forEach((row, j) => { if (j > 0 && String(row[0]) === id) borrar.push({ sheetId: SHEET_IDS[t], fila: j }); });
    });
    borrar.sort((a, b) => b.fila - a.fila);
    if (borrar.length) await G.lote(borrar.map(b => ({ deleteDimension: { range: { sheetId: b.sheetId, dimension: 'ROWS', startIndex: b.fila, endIndex: b.fila + 1 } } })));
    for (const t of tabs) if (porTab[t].length) await G.agregar(t + '!A1', porTab[t].map(f => aHeader(t, f)));
  }

  async function log(accion, importacion, detalle) {
    try { await G.agregar('BD_Log!A1', [[new Date().toISOString(), USUARIO?.email || '', accion, importacion || '', detalle || '']]); } catch (e) {}
  }

  // Guarda una importación completa: fila, costeo, productos y pagos.
  async function guardarImportacion(id, accion = 'Edición') {
    if (!EDITOR) throw new Error('Tu cuenta tiene acceso de solo lectura');
    // ¿Otro usuario la cambió desde que la cargamos?
    const r = await G.leer(['BD_Importaciones!A:A', 'BD_Importaciones!1:1']);
    const h = (r.valueRanges[1].values || [[]])[0], iAct = h.indexOf('actualizado'), iPor = h.indexOf('actualizado_por');
    const filas = (r.valueRanges[0].values || []), j = filas.findIndex((x, k) => k > 0 && String(x[0]) === id);
    if (j > 0 && iAct >= 0) {
      const fila = (await G.leer([`BD_Importaciones!A${j + 1}:BZ${j + 1}`])).valueRanges[0].values?.[0] || [];
      const act = String(fila[iAct] || ''), por = fila[iPor] || '';
      if (VERSION_FILA[id] !== undefined && act && act !== VERSION_FILA[id] && por !== USUARIO?.email) {
        if (!confirm(`${id} fue modificada por ${por} el ${new Date(act).toLocaleString('es-CL')} después de que abriste la app.\n\n¿Sobrescribir con tus cambios? (Cancelar recarga los datos)`)) { await cargar(); throw new Error('recargado'); }
      }
    }
    const fi = filaImportacion(id);
    await reemplazar(id, { BD_Importaciones: [fi], BD_Costeo: filasCosteo(id), BD_Productos: filasProductos(id), BD_Pagos: filasPagos(id) });
    VERSION_FILA[id] = fi[SCHEMA.BD_Importaciones.indexOf('actualizado')];
    const e = EMB.find(x => x.id === id); if (e) { e.actualizado = VERSION_FILA[id]; e.actualizadoPor = USUARIO?.email; }
    log(accion, id, '');
  }

  async function guardarConfig(pares) {
    if (!EDITOR) throw new Error('Tu cuenta tiene acceso de solo lectura');
    const r = await G.leer(['BD_Config!A:A']);
    const filas = r.valueRanges[0].values || [];
    const data = [], nuevas = [];
    Object.entries(pares).forEach(([k, val]) => {
      CFG[k] = val;
      const j = filas.findIndex(x => x[0] === k);
      if (j > 0) data.push({ range: `BD_Config!B${j + 1}`, values: [[val]] }); else nuevas.push([k, val, '']);
    });
    if (data.length) await G.escribir(data);
    if (nuevas.length) await G.agregar('BD_Config!A1', nuevas);
    log('Configuración', '', Object.keys(pares).join(', '));
  }

  async function asignarCorreo(threadId, importacion) {
    const r = await G.leer(['BD_Correos!A:A', 'BD_Correos!1:1']);
    const h = r.valueRanges[1].values[0], j = (r.valueRanges[0].values || []).findIndex(x => x[0] === threadId);
    if (j < 1) throw new Error('Correo no encontrado');
    const L = i => String.fromCharCode(65 + i);
    await G.escribir([{ range: `BD_Correos!${L(h.indexOf('importacion'))}${j + 1}`, values: [[importacion]] }, { range: `BD_Correos!${L(h.indexOf('estado'))}${j + 1}`, values: [[importacion ? 'asignado' : 'ignorado']] }]);
    const c = CORREOS.find(x => x.thread_id === threadId); if (c) { c.importacion = importacion; c.estado = importacion ? 'asignado' : 'ignorado'; }
    log('Asignar correo', importacion, threadId);
  }

  // ¿Existen las pestañas BD? Si no, la app ofrece crearlas con un archivo semilla.
  async function faltantes() { await idsHojas(); return TABS.filter(t => !(t in SHEET_IDS)); }
  async function inicializar(semilla, soloEstas) {
    const falt = soloEstas || await faltantes();
    if (falt.length) await G.lote(falt.map(t => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })));
    await idsHojas();
    const data = falt.map(t => ({ range: t + '!A1', values: [SCHEMA[t], ...((semilla && semilla[t]) || [])] }));
    await G.escribir(data);
    await G.lote(falt.map(t => ({ repeatCell: { range: { sheetId: SHEET_IDS[t], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: .93, green: .92, blue: 1 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } })));
    log('Inicializar base', '', 'Pestañas BD creadas');
  }

  // Aplica un archivo de actualización: {fecha, stock:{fecha, meses, filas}, pagos:[{importacion, pago_id, fecha?, fuente?, est?, concepto?, tc?}]}
  async function aplicarActualizacion(act) {
    if (!EDITOR) throw new Error('Tu cuenta tiene acceso de solo lectura');
    const hecho = [];
    if (act.stock && act.stock.filas && act.stock.filas.length) {
      if (!Object.keys(SHEET_IDS).length) await idsHojas();
      const r = await G.leer(['BD_Stock!A:A']); const n = (r.valueRanges[0].values || []).length;
      if (n > 1) await G.lote([{ deleteDimension: { range: { sheetId: SHEET_IDS.BD_Stock, dimension: 'ROWS', startIndex: 1, endIndex: n } } }]);
      await G.agregar('BD_Stock!A1', act.stock.filas.map(f => aHeader('BD_Stock', f)));
      await guardarConfig({ stock_fecha: act.stock.fecha, meses_stock: act.stock.meses.join(',') });
      hecho.push(`stock de ${act.stock.filas.length} SKU al ${act.stock.fecha}`);
    }
    const imps = new Set();
    (act.pagos || []).forEach(u => {
      const l = PAGOS[u.importacion] || []; const p = l.find(x => x[8] === u.pago_id); if (!p) return;
      if (u.fecha) p[0] = u.fecha; if (u.concepto) p[2] = u.concepto; if (u.tc !== undefined) p[5] = u.tc;
      if (u.fuente) p[6] = u.fuente; if (u.est !== undefined) p[7] = u.est; if (u.respaldo) p[9] = u.respaldo;
      imps.add(u.importacion);
    });
    for (const id of imps) await guardarImportacion(id, 'Actualización de pagos');
    if (imps.size) hecho.push(`pagos de ${[...imps].join(', ')}`);
    log('Cargar actualización', '', hecho.join(' · '));
    return hecho.length ? 'Actualizado: ' + hecho.join(' · ') : 'El archivo no traía cambios';
  }

  async function borrarImportacion(id) {
    await reemplazar(id, { BD_Importaciones: [], BD_Costeo: [], BD_Productos: [], BD_Pagos: [] });
    log('Borrar importación', id, '');
  }

  return { aplicarActualizacion, borrarImportacion, cargar, construir, guardarImportacion, guardarConfig, asignarCorreo, faltantes, inicializar, log, filaImportacion, filasCosteo, filasProductos, filasPagos, objetos };
})();
