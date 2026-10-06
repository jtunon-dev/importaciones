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
