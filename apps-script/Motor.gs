/**
 * Motor de sincronización de la app de importaciones.
 * Va pegado en el editor de Apps Script del Sheets IMPORTACIONES 2EBOX (Extensiones → Apps Script)
 * y corre con la cuenta de quien lo instala (Gmail y Drive de esa cuenta).
 *
 *   instalar()      → ejecutar UNA vez: crea el disparador cada 15 minutos y hace la primera pasada.
 *   sincronizar()   → lo que corre cada 15 minutos (también se puede ejecutar a mano).
 *   desinstalar()   → borra el disparador.
 *
 * Qué hace cada pasada:
 *   1. Drive: busca la carpeta de cada importación (Carpeta raíz / Línea / "<Importación> (fecha)"),
 *      guarda su id en BD_Importaciones y lista los documentos en BD_Documentos (PI, invoice, BL, DIN, Swift, set…).
 *   2. Gmail: busca correos de órdenes, PI, pagos, DIN y arribos (consulta en BD_Config → gmail_consulta),
 *      los asocia a una importación por sus referencias y los anota en BD_Correos.
 *   3. Adjuntos: los correos asociados (por el motor o a mano en la app) guardan sus adjuntos en la carpeta
 *      de la importación, sin duplicar nombres.
 */

var MAX_HILOS = 150;

function instalar() {
  desinstalar();
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(15).create();
  sincronizar();
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
}

function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = SpreadsheetApp.getActive();
    var cfg = leerConfig_(ss);
    var imps = leerTabla_(ss, 'BD_Importaciones');
    var resDrive = escanearDrive_(ss, cfg, imps);
    var resGmail = escanearGmail_(ss, cfg, imps);
    var resAdj = guardarAdjuntos_(ss, imps);
    log_(ss, 'Motor', '', 'Drive: ' + resDrive + ' · Gmail: ' + resGmail + ' · Adjuntos: ' + resAdj);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Drive ---------------- */
function clasificar_(nombre) {
  var n = nombre.toLowerCase();
  if (/^\d{4,5}\.pdf$/.test(n) || /\bset\b/.test(n)) return 'Set importación';
  if (/\bdin\b|declaraci[oó]n de ingreso|^\d{10}-?\d?\b/.test(n)) return 'DIN';
  if (/swift|mt103|transferencia|comprobante de pago/.test(n)) return 'Swift';
  if (/packing/.test(n)) return 'Packing list';
  if (/proforma|\bpi\b|\bpi[\s_-]?\d|^pi/.test(n)) return 'PI';
  if (/invoice|factura comercial|\bci\b/.test(n)) return 'Invoice';
  if (/\bh?bl\b|bill of lading|\bb-l\b|conocimiento/.test(n)) return 'BL';
  return 'Otro';
}

function buscarCarpetaImportacion_(raiz, linea, id, nombreGuardado) {
  var lineas = raiz.getFoldersByName(linea);
  while (lineas.hasNext()) {
    var it = lineas.next().getFolders();
    while (it.hasNext()) {
      var f = it.next(), n = f.getName();
      if (n === nombreGuardado || n === id || n.indexOf(id + ' (') === 0) return f;
    }
  }
  return null;
}

function listarArchivos_(carpeta, prof, out) {
  var fs = carpeta.getFiles();
  while (fs.hasNext()) out.push(fs.next());
  if (prof > 0) {
    var sub = carpeta.getFolders();
    while (sub.hasNext()) listarArchivos_(sub.next(), prof - 1, out);
  }
  return out;
}

function escanearDrive_(ss, cfg, imps) {
  var raiz = DriveApp.getFolderById(cfg.carpeta_raiz_id);
  var hDoc = cabecera_(ss, 'BD_Documentos');
  var docs = leerTabla_(ss, 'BD_Documentos');
  var escaneadas = {}, nuevas = [], cambiosImp = [];
  imps.filas.forEach(function (r) {
    var id = String(r.id || '');
    if (!id) return;
    var carpeta = null;
    try { if (r.carpeta_id) carpeta = DriveApp.getFolderById(r.carpeta_id); } catch (e) { carpeta = null; }
    if (!carpeta) {
      carpeta = buscarCarpetaImportacion_(raiz, r.linea, id, r.carpeta);
      if (carpeta) cambiosImp.push({ fila: r._fila, carpeta_id: carpeta.getId(), carpeta: carpeta.getName() });
    }
    if (!carpeta) return;
    escaneadas[id] = true;
    listarArchivos_(carpeta, 1, []).forEach(function (f) {
      nuevas.push(fila_(hDoc, { importacion: id, tipo: clasificar_(f.getName()), archivo: f.getName(), file_id: f.getId(), url: f.getUrl(), modificado: f.getLastUpdated().toISOString().slice(0, 10) }));
    });
  });
  // Conserva las filas de importaciones cuya carpeta no se encontró; reemplaza las demás.
  var quedan = docs.filas.filter(function (d) { return !escaneadas[d.importacion]; }).map(function (d) { return fila_(hDoc, d); });
  reescribir_(ss, 'BD_Documentos', hDoc, quedan.concat(nuevas));
  cambiosImp.forEach(function (c) {
    escribirCelda_(ss, 'BD_Importaciones', imps.cab, c.fila, 'carpeta_id', c.carpeta_id);
    escribirCelda_(ss, 'BD_Importaciones', imps.cab, c.fila, 'carpeta', c.carpeta);
    imps.filas.forEach(function (r) { if (r._fila === c.fila) { r.carpeta_id = c.carpeta_id; r.carpeta = c.carpeta; } });
  });
  return Object.keys(escaneadas).length + ' carpetas, ' + nuevas.length + ' archivos';
}

/* ---------------- Gmail ---------------- */
function tokens_(imps) {
  // Referencias que identifican a cada importación en un correo.
  var out = [];
  imps.filas.forEach(function (r) {
    var id = String(r.id || ''); if (!id) return;
    var t = [];
    [r.ref, r.ref_klog].forEach(function (x) { x = String(x || '').trim(); if (x.length >= 5 && !/^borrador$/i.test(x)) t.push(x); });
    var din = String(r.din_n || '').replace(/\D/g, ''); if (din.length >= 10) t.push(din.slice(0, 10));
    if (r.set_n) { t.push('EMB-' + r.set_n); t.push('EMB ' + r.set_n); t.push('embarque ' + r.set_n); }
    t.push(id);
    out.push({ id: id, t: t });
  });
  return out;
}

// Busca la referencia como palabra completa ("Chimenea 4" no calza con "Chimenea 40").
function contiene_(texto, ref) {
  var r = ref.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + r + '($|[^a-z0-9])').test(texto);
}

function tipoCorreo_(txt) {
  var s = txt.toLowerCase();
  if (/swift|mt103|transferencia|payment|pago realizado|comprobante de pago|remittance/.test(s)) return 'Pago';
  if (/\bdin\b|solicitud de fondos|internaci[oó]n|aduana|declaraci[oó]n de ingreso/.test(s)) return 'Internación';
  if (/arribo|lleg[oó] a bodega|recepci[oó]n de carga/.test(s)) return 'Arribo';
  if (/zarpe|b\/l|\bbl\b|booking|embarque|shipment|vessel/.test(s)) return 'Embarque';
  if (/new order|nueva orden|orden n|order no|purchase order|proforma|\bpi\b/.test(s)) return 'Orden';
  if (/invoice|factura/.test(s)) return 'Factura';
  return 'Otro';
}

function escanearGmail_(ss, cfg, imps) {
  var h = cabecera_(ss, 'BD_Correos');
  var existentes = {};
  leerTabla_(ss, 'BD_Correos').filas.forEach(function (c) { existentes[c.thread_id] = true; });
  var tk = tokens_(imps), nuevos = [];
  var hilos = GmailApp.search(cfg.gmail_consulta, 0, MAX_HILOS);
  hilos.forEach(function (th) {
    var tid = th.getId();
    if (existentes[tid]) return;
    var msgs = th.getMessages(), asunto = th.getFirstMessageSubject() || '(sin asunto)';
    var texto = asunto + '\n', adj = [];
    msgs.forEach(function (m) {
      texto += m.getPlainBody().slice(0, 20000) + '\n';
      m.getAttachments({ includeInlineImages: false }).forEach(function (a) { if (adjuntoUtil_(a)) adj.push(a.getName()); });
    });
    var hay = texto.toLowerCase();
    var cand = tk.filter(function (x) { return x.t.some(function (t) { return contiene_(hay, t); }); });
    // Si calzan varias, se prefiere la que calza por referencia (no solo por nombre).
    if (cand.length > 1) {
      var porRef = cand.filter(function (x) { return x.t.slice(0, -1).some(function (t) { return contiene_(hay, t); }); });
      if (porRef.length) cand = porRef;
    }
    var imp = cand.length === 1 ? cand[0].id : '';
    var ultimo = msgs[msgs.length - 1];
    nuevos.push(fila_(h, {
      thread_id: tid, fecha: ultimo.getDate().toISOString().slice(0, 10), de: msgs[0].getFrom(), asunto: asunto,
      importacion: imp, tipo: tipoCorreo_(texto.slice(0, 4000)), adjuntos: adj.join(', '),
      estado: imp ? 'asignado' : 'por asignar', link: 'https://mail.google.com/mail/u/0/#all/' + tid
    }));
  });
  if (nuevos.length) agregar_(ss, 'BD_Correos', nuevos);
  return nuevos.length + ' correos nuevos';
}

function adjuntoUtil_(a) {
  var n = a.getName().toLowerCase(), t = a.getContentType();
  if (/\.(pdf|xlsx?|csv|docx?)$/.test(n)) return true;
  if (/^image\//.test(t)) return a.getSize() > 60000; // fotos de documentos sí; logos de firma no
  return false;
}

function guardarAdjuntos_(ss, imps) {
  var cor = leerTabla_(ss, 'BD_Correos'), guardados = 0;
  var carpetas = {};
  imps.filas.forEach(function (r) { if (r.carpeta_id) carpetas[r.id] = r.carpeta_id; });
  cor.filas.forEach(function (c) {
    if (c.estado !== 'asignado' || !c.importacion || !carpetas[c.importacion]) return;
    var carpeta = DriveApp.getFolderById(carpetas[c.importacion]);
    var hay = {};
    listarArchivos_(carpeta, 1, []).forEach(function (f) { hay[f.getName()] = true; });
    var th = GmailApp.getThreadById(c.thread_id);
    if (th) th.getMessages().forEach(function (m) {
      m.getAttachments({ includeInlineImages: false }).forEach(function (a) {
        if (!adjuntoUtil_(a) || hay[a.getName()]) return;
        carpeta.createFile(a.copyBlob()).setName(a.getName());
        hay[a.getName()] = true; guardados++;
      });
    });
    escribirCelda_(ss, 'BD_Correos', cor.cab, c._fila, 'estado', 'archivado');
  });
  return guardados + ' archivos guardados';
}

/* ---------------- utilidades de hoja ---------------- */
function hoja_(ss, n) {
  var h = ss.getSheetByName(n);
  if (!h) throw new Error('Falta la pestaña ' + n + '. Ábrela primero desde la app para crear la base.');
  return h;
}
function cabecera_(ss, n) { return hoja_(ss, n).getRange(1, 1, 1, hoja_(ss, n).getLastColumn()).getValues()[0].map(String); }
function leerTabla_(ss, n) {
  var h = hoja_(ss, n), v = h.getDataRange().getValues(), cab = v[0].map(String), filas = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i].some(function (x) { return x !== ''; })) continue;
    var o = { _fila: i + 1 };
    cab.forEach(function (k, j) { o[k] = v[i][j] instanceof Date ? Utilities.formatDate(v[i][j], 'GMT-3', 'yyyy-MM-dd') : v[i][j]; });
    filas.push(o);
  }
  return { cab: cab, filas: filas };
}
function leerConfig_(ss) {
  var c = {};
  leerTabla_(ss, 'BD_Config').filas.forEach(function (r) { c[r.clave] = r.valor; });
  if (!c.carpeta_raiz_id) throw new Error('Falta carpeta_raiz_id en BD_Config');
  if (!c.gmail_consulta) c.gmail_consulta = 'newer_than:30d (subject:("new order" OR "nueva orden" OR orden OR order OR proforma OR swift OR DIN OR arribo))';
  return c;
}
function fila_(cab, o) { return cab.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }); }
function agregar_(ss, n, filas) { var h = hoja_(ss, n); h.getRange(h.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas); }
function reescribir_(ss, n, cab, filas) {
  var h = hoja_(ss, n), ult = h.getLastRow();
  if (ult > 1) h.getRange(2, 1, ult - 1, cab.length).clearContent();
  if (filas.length) h.getRange(2, 1, filas.length, cab.length).setValues(filas);
}
function escribirCelda_(ss, n, cab, fila, col, valor) {
  var j = cab.indexOf(col); if (j < 0) return;
  hoja_(ss, n).getRange(fila, j + 1).setValue(valor);
}
function log_(ss, accion, imp, detalle) {
  try { agregar_(ss, 'BD_Log', [[new Date().toISOString(), Session.getActiveUser().getEmail() || 'motor', accion, imp, detalle]]); } catch (e) {}
}

/* ================= Reporte mensual a gerencia =================
 * Se envía solo el PRIMER JUEVES de cada mes: el disparador corre todos los jueves a las 8:00
 * y revisa si es el primero del mes. Destinatarios: BD_Config → reporte_destinatarios (separados por coma).
 *   instalarReporte()  → ejecutar UNA vez para crear el disparador.
 *   probarReporte()    → envía el reporte de hoy solo a tu correo, para revisarlo.
 */
var APP_URL = 'https://jtunon-dev.github.io/importaciones/';

function instalarReporte() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'reporteMensual') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('reporteMensual').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create();
}

function reporteMensual(e) {
  var hoy = new Date();
  var forzar = e === true;
  if (!forzar && hoy.getDate() > 7) return; // solo el primer jueves del mes
  var ss = SpreadsheetApp.getActive(), cfg = leerConfig_(ss);
  var para = String(cfg.reporte_destinatarios || '').trim();
  if (!para) throw new Error('Falta reporte_destinatarios en BD_Config');
  var r = armarReporte_(ss, cfg, hoy);
  GmailApp.sendEmail(para, r.asunto, r.texto, { htmlBody: r.html, name: 'Importaciones retail.cl' });
  log_(ss, 'Reporte mensual', '', 'Enviado a ' + para);
}

function probarReporte() {
  var ss = SpreadsheetApp.getActive(), cfg = leerConfig_(ss);
  var r = armarReporte_(ss, cfg, new Date());
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), '[Prueba] ' + r.asunto, r.texto, { htmlBody: r.html, name: 'Importaciones retail.cl' });
}

function armarReporte_(ss, cfg, hoy) {
  var tz = ss.getSpreadsheetTimeZone() || 'America/Santiago';
  var f = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var hoyS = f(hoy), en30 = f(new Date(hoy.getTime() + 30 * 864e5)), en90 = f(new Date(hoy.getTime() + 90 * 864e5));
  var tc = Number(cfg.tc_ref) || 935;
  var clp = function (n) { return '$' + Math.round(n).toLocaleString('es-CL'); };
  var fecha = function (s) { if (!s) return '—'; var p = String(s).split('-'); return p.length < 3 ? s : p[2] + '-' + p[1] + '-' + p[0].slice(2); };
  var imps = leerTabla_(ss, 'BD_Importaciones').filas;
  var pagos = leerTabla_(ss, 'BD_Pagos').filas;
  var stock = leerTabla_(ss, 'BD_Stock').filas;
  var aClp = function (p) { var m = Number(p.monto) || 0; return p.moneda === 'USD' ? m * (Number(p.tc) || tc) : m; };
  var suma = function (a) { return a.reduce(function (s, p) { return s + aClp(p); }, 0); };

  // Importaciones en curso
  var curso = imps.filter(function (e) { return e.estado && e.estado !== 'Recibido'; });
  var filasImp, filasPag;
  filasImp = curso.map(function (e) {
    var eta = e.bodega || e.bodega_est || e.eta || e.eta_est || '';
    return '<tr><td><b>' + e.id + '</b><br><span style="color:#8A86A6">' + (e.ref || '') + '</span></td><td>' + e.estado + '</td><td>' + (e.proveedor || '') +
      '</td><td align="right">' + (e.unidades || '—') + '</td><td align="right">US$ ' + Math.round(Number(e.fob_usd) || 0).toLocaleString('es-CL') +
      '</td><td>' + fecha(eta) + '</td></tr>';
  }).join('');

  // Pagos
  var futuros = pagos.filter(function (p) { return p.fecha >= hoyS; });
  var p30 = futuros.filter(function (p) { return p.fecha <= en30; }), p90 = futuros.filter(function (p) { return p.fecha <= en90; });
  var y = hoyS.slice(0, 4), ya = String(+y - 1), corte = hoyS.slice(5);
  var pagY = suma(pagos.filter(function (p) { return p.fecha && String(p.fecha).slice(0, 4) === y && p.fecha < hoyS; }));
  var pagYa = suma(pagos.filter(function (p) { return p.fecha && String(p.fecha).slice(0, 4) === ya && String(p.fecha).slice(5) < corte; }));
  var yoyN = pagYa ? (pagY / pagYa - 1) * 100 : null;
  var yoy = yoyN == null ? '—' : (yoyN > 0 ? '+' : '') + yoyN.toFixed(1).replace('.', ',') + '%';
  p30.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  filasPag = p30.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }).map(function (p) {
    return '<tr><td>' + fecha(p.fecha) + (String(p.fecha_estimada).indexOf('S') === 0 ? ' <span style="color:#8A86A6">(est.)</span>' : '') + '</td><td>' + p.importacion + '</td><td>' + p.concepto +
      '</td><td align="right">' + (p.moneda === 'USD' ? 'US$ ' + Number(p.monto).toLocaleString('es-CL') : clp(p.monto)) + '</td></tr>';
  }).join('');

  // Stock y reposición: misma lógica que la vista Reposición de la app
  var valor = stock.reduce(function (s, x) { return s + (Number(x.valor_clp) || 0); }, 0);
  var sup = {}; try { sup = JSON.parse(cfg.supuestos_json || '{}'); } catch (err) {}
  var prods = leerTabla_(ss, 'BD_Productos').filas, transito = {};
  imps.filter(function (e) { return e.estado === 'En producción' || e.estado === 'En tránsito'; }).forEach(function (e) {
    var eta = e.bodega || e.bodega_est || e.eta_est || e.eta; if (!eta) return;
    prods.filter(function (p) { return String(p.id) === String(e.id); }).forEach(function (p) {
      var t = transito[p.sku] = transito[p.sku] || { q: 0, eta: eta }; t.q += Number(p.unidades) || 0; if (eta < t.eta) t.eta = eta;
    });
  });
  var dias = function (a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); };
  var alertas = [];
  stock.forEach(function (x) {
    if (String(x.descontinuado).indexOf('S') === 0 || String(x.nuevo).indexOf('S') === 0) return;
    var p = sup[x.linea] || { lt: 90, ss: 21, rev: 30, moq: 1, est: 1 };
    var v = []; for (var i = 1; i <= 12; i++) v.push(Number(x['v' + (i < 10 ? '0' : '') + i]) || 0);
    var con = v.slice(-6).filter(function (n) { return n > 0; });
    var prom = (con.length ? con.reduce(function (a, b) { return a + b; }, 0) / con.length : 0) * (p.est || 1);
    if (!prom) return;
    var diaria = prom / 30, st = Number(x.stock) || 0, tr = transito[x.sku] || { q: 0, eta: null };
    var rop = diaria * (p.lt + p.ss), pos = st + tr.q, target = diaria * (p.lt + p.rev) + diaria * p.ss;
    var sug = Math.ceil(Math.max(0, target - pos) / (p.moq || 1)) * (p.moq || 1);
    var sit = null, grupo = null;
    if (st === 0 && !tr.q) { sit = 'Sin stock ni carga en camino'; grupo = 1; }
    else if (st === 0) { sit = 'Sin stock · llegan ' + tr.q + ' u el ' + fecha(tr.eta); grupo = 1; }
    else if (tr.q && tr.eta && st < diaria * dias(hoyS, tr.eta)) { sit = 'Se agota ~' + fecha(f(new Date(hoy.getTime() + st / diaria * 864e5))) + ', antes de la llegada (' + fecha(tr.eta) + ')'; grupo = 2; }
    else if (pos < rop) { sit = 'Bajo el punto de reorden: pedir ahora'; grupo = 2; }
    if (grupo) alertas.push({ x: x, sit: sit, grupo: grupo, prom: prom, tr: tr.q, sug: grupo === 2 || !tr.q ? sug : 0 });
  });
  alertas.sort(function (a, b) { return a.grupo - b.grupo || b.prom - a.prom; });

  var mes = Utilities.formatDate(hoy, tz, 'MMMM yyyy');
  var asunto = 'Importaciones retail.cl · reporte ' + mes;
  // HTML apto para correo: tablas, bgcolor y estilos en línea (Gmail y Outlook ignoran CSS moderno)
  var BORDE = '1px solid #CFCBE2', NAVY = '#1B1640', LILA = '#EEEDF5';
  var kpi = function (t, v, d) {
    return '<td class="kpi" width="49%" height="96" valign="top" bgcolor="' + NAVY + '" style="background-color:' + NAVY + ';height:96px;border-radius:10px;padding:12px 14px;font-family:Arial,sans-serif">' +
      '<div style="font-size:10px;letter-spacing:1px;color:#C9C2EE;text-transform:uppercase">' + t + '</div>' +
      '<div class="kpi-v" style="font-size:22px;font-weight:bold;color:#FFFFFF;margin:6px 0 4px">' + v + '</div>' +
      '<div style="font-size:11px;color:#C9C2EE">' + d + '</div></td>';
  };
  var grilla = function (k) {
    var sep = '<td width="2%" style="font-size:0;line-height:0">&nbsp;</td>';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px">' +
      '<tr>' + k[0] + sep + k[1] + '</tr><tr><td colspan="3" height="10" style="font-size:0;line-height:0;height:10px">&nbsp;</td></tr>' +
      '<tr>' + k[2] + sep + k[3] + '</tr></table>';
  };
  var th = function (c, der, oc) { return '<th' + (oc ? ' class="ocultar-m"' : '') + ' align="' + (der ? 'right' : 'left') + '" bgcolor="' + LILA + '" style="background-color:' + LILA + ';border:' + BORDE + ';padding:7px 9px;font-size:12px;color:' + NAVY + '">' + c + '</th>'; };
  var tabla = function (cab, der, filas, vacio, ocultar) {
    ocultar = ocultar || [];
    if (!filas) return '<p style="color:#8A86A6;font-size:13px">' + vacio + '</p>';
    return '<table class="tbl" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:' + BORDE + ';font-size:13px;font-family:Arial,sans-serif">' +
      '<tr>' + cab.map(function (c, i) { return th(c, der.indexOf(i) >= 0, ocultar.indexOf(i) >= 0); }).join('') + '</tr>' + filas + '</table>';
  };
  var td = function (v, der, extra, oc) { return '<td' + (oc ? ' class="ocultar-m"' : '') + ' align="' + (der ? 'right' : 'left') + '" style="border:' + BORDE + ';padding:7px 9px;color:' + NAVY + (der ? ';white-space:nowrap' : '') + (extra || '') + '">' + v + '</td>'; };
  filasImp = curso.map(function (e) {
    var eta = e.bodega || e.bodega_est || e.eta || e.eta_est || '';
    return '<tr>' + td('<b>' + e.id + '</b><br><span style="color:#8A86A6;font-size:12px">' + (e.ref || '') + '</span>') + td(e.estado) + td(e.proveedor || '', false, '', true) +
      td(e.unidades || '—', true, '', true) + td('US$ ' + Math.round(Number(e.fob_usd) || 0).toLocaleString('es-CL'), true) + td(fecha(eta), false, ';white-space:nowrap') + '</tr>';
  }).join('');
  filasPag = p30.map(function (p) {
    return '<tr>' + td(fecha(p.fecha) + (String(p.fecha_estimada).indexOf('S') === 0 ? '<br><span style="color:#8A86A6;font-size:11px">estimada</span>' : ''), false, ';white-space:nowrap') +
      td(p.importacion) + td(p.concepto) + td(p.moneda === 'USD' ? 'US$ ' + Number(p.monto).toLocaleString('es-CL') : clp(p.monto), true) + '</tr>';
  }).join('');
  var boton = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td bgcolor="#6D49F2" style="background-color:#6D49F2;border-radius:8px">' +
    '<a href="' + APP_URL + '" target="_blank" style="display:inline-block;padding:11px 22px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px">Abrir app de importaciones →</a></td></tr></table>';
  var estilo = '<style>@media only screen and (max-width:520px){' +
    '.envoltorio{padding:8px 0!important}.marco{padding:14px 10px!important}.kpi{padding:10px 10px!important}.kpi-v{font-size:17px!important}' +
    '.tbl th,.tbl td{padding:5px 5px!important;font-size:11.5px!important}.ocultar-m{display:none!important}.titulo{font-size:19px!important}}</style>';
  var html = estilo + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#E7E8EF" style="background-color:#E7E8EF"><tr><td class="envoltorio" align="center" style="padding:16px 8px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F6F6FA" style="max-width:720px;width:100%;background-color:#F6F6FA;border:' + BORDE + ';border-radius:12px;font-family:Arial,sans-serif;color:' + NAVY + '"><tr><td class="marco" style="padding:20px 22px">' +
    '<div class="titulo" style="font-size:22px;font-weight:bold">Importaciones · ' + mes + '</div>' +
    '<div style="font-size:13px;color:#4F4A70;margin:4px 0 10px">Resumen automático al ' + fecha(hoyS) + '. El detalle en vivo (costeos, factores, reposición) está en la app:</div>' + boton +
    grilla([kpi('Importaciones en curso', String(curso.length), curso.map(function (e) { return e.id; }).join(', ') || '—'),
      kpi('Por pagar 30 días', clp(suma(p30)), p30.length + ' pagos'),
      kpi('Por pagar 90 días', clp(suma(p90)), p90.length + ' pagos'),
      kpi('Pagado ' + y, clp(pagY), 'vs ' + ya + ' a la fecha: ' + yoy)]) +
    '<div style="font-size:16px;font-weight:bold;margin:18px 0 8px">Importaciones en curso</div>' + tabla(['Importación', 'Estado', 'Proveedor', 'Unidades', 'FOB', 'ETA bodega'], [3, 4], filasImp, 'No hay importaciones en curso.', [2, 3]) +
    '<div style="font-size:16px;font-weight:bold;margin:18px 0 8px">Pagos de los próximos 30 días</div>' + tabla(['Fecha', 'Importación', 'Concepto', 'Monto'], [3], filasPag, 'Sin pagos en los próximos 30 días.') +
    '<div style="font-size:16px;font-weight:bold;margin:18px 0 4px">Stock y reposición</div>' +
    '<div style="font-size:13px;color:#4F4A70;margin:0 0 8px">Inventario valorizado: <b style="color:' + NAVY + '">' + clp(valor) + '</b> (corte Defontana ' + fecha(cfg.stock_fecha) + ')</div>' +
    tabla(['Producto', 'Situación', 'Stock', 'Venta/mes', 'Sugerido'], [2, 3, 4], alertas.map(function (a) {
      var chip = a.grupo === 1 ? ['#FBE1E5', '#C9334B', 'Sin stock'] : ['#FCEFD6', '#B9740B', 'Urgente'];
      return '<tr>' + td('<b>' + a.x.nombre + '</b><br><span style="color:#8A86A6;font-size:12px">' + a.x.sku + '</span>') +
        td('<span style="background-color:' + chip[0] + ';color:' + chip[1] + ';font-weight:bold;font-size:11px;padding:2px 8px;border-radius:9px;white-space:nowrap">' + chip[2] + '</span><br><span style="font-size:12px">' + a.sit + '</span>') +
        td(String(Number(a.x.stock) || 0), true) + td(a.prom.toFixed(1).replace('.', ','), true, '', true) + td(a.sug ? a.sug + ' u' : '—', true) + '</tr>';
    }).join(''), 'Sin productos sin stock ni con urgencia de reposición.', [3]) +
    '<div style="font-size:11px;color:#8A86A6;margin-top:16px">Montos en USD sin T/C registrado se valorizan a ' + tc + '. Para entrar a la app usa tu cuenta de Google de la empresa: ' + APP_URL + '</div>' +
    '</td></tr></table></td></tr></table>';
  var texto = asunto + '\n\nEn curso: ' + curso.length + ' importaciones. Por pagar 30 días: ' + clp(suma(p30)) + '. Por pagar 90 días: ' + clp(suma(p90)) +
    '. Pagado ' + y + ': ' + clp(pagY) + ' (vs ' + ya + ': ' + yoy + ').\nDetalle: ' + APP_URL;
  return { asunto: asunto, html: html, texto: texto };
}
