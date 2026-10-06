/* Ambiente QA (artifact de Claude): reemplaza a google.js con la MISMA interfaz `G`,
   pero guarda las pestañas BD_* en la base del artifact (db), no en el Sheets de producción.
   Cada pestaña es un documento qa/<pestaña> con sus filas en JSON; semilla/<pestaña> guarda
   la copia para "Reiniciar QA". */
window.ENTORNO = 'QA';
const G = (() => {
  let db = null, yo = null, puede = true;
  const T = {};            // pestaña → filas (incluye encabezado)
  const ID = {};           // pestaña → sheetId ficticio
  const pend = {}, cola = {};
  const nid = t => ID[t] ?? (ID[t] = Object.keys(ID).length + 100);

  async function init() {
    db = await window.claude?.use?.('db');
    const u = await window.claude?.use?.('user');
    if (u) { try { yo = await u.me(); } catch (e) {} const c = u.can ? await u.can('data.write') : null; if (c === false) puede = false; }
    if (!db) throw new Error('Este ambiente QA necesita la base del artifact (db) y no está disponible en esta vista.');
    const snap = await db.collection('qa').get();
    snap.docs.forEach(d => { const x = d.data(); try { T[d.id] = JSON.parse(x.json); nid(d.id); } catch (e) {} });
  }
  function persistir(t) {
    clearTimeout(pend[t]);
    pend[t] = setTimeout(() => {
      cola[t] = (cola[t] || Promise.resolve()).then(() => db.doc('qa/' + t).set({ json: JSON.stringify(T[t]), actualizado: new Date().toISOString() }));
    }, 300);
  }
  async function reiniciar() {
    const s = await db.collection('semilla').get();
    if (s.empty) throw new Error('No hay semilla cargada en este artifact.');
    for (const d of s.docs) { T[d.id] = JSON.parse(d.data().json); nid(d.id); await db.doc('qa/' + d.id).set({ json: d.data().json, actualizado: new Date().toISOString() }); }
  }

  const col = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  function rango(r) {
    const [t, a1] = r.split('!'); const rows = T[t] || [];
    let m = a1.match(/^([A-Z]+):([A-Z]+)$/);
    if (m) { const a = col(m[1]), b = col(m[2]); return rows.map(x => x.slice(a, b + 1)); }
    m = a1.match(/^(\d+):(\d+)$/); if (m) return rows.slice(+m[1] - 1, +m[2]);
    m = a1.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (m) { const a = col(m[1]), b = col(m[3]); return rows.slice(+m[2] - 1, +m[4]).map(x => x.slice(a, b + 1)); }
    throw new Error('Rango no soportado en QA: ' + r);
  }
  function poner(r, values) {
    const [t, a1] = r.split('!'); const m = a1.match(/^([A-Z]+)(\d+)/); const c0 = col(m[1]), r0 = +m[2];
    T[t] = T[t] || [];
    values.forEach((row, i) => {
      while (T[t].length < r0 + i) T[t].push([]);
      const tgt = T[t][r0 - 1 + i];
      row.forEach((v, j) => { while (tgt.length <= c0 + j) tgt.push(''); tgt[c0 + j] = v; });
    });
    persistir(t);
  }
  const ok = x => Promise.resolve(x);
  return {
    init, reiniciar, login: ok, logout() {}, conectado: () => true, permisosOk: () => true,
    usuario: () => ok({ email: (yo && yo.email) || 'qa@prueba', name: ((yo && yo.name) || 'Usuario') + ' (QA)' }),
    meta: () => ok({ sheets: Object.keys(T).map(t => ({ properties: { title: t, sheetId: nid(t) } })) }),
    leer: ranges => ok({ valueRanges: ranges.map(r => ({ range: r, values: rango(r) })) }),
    escribir: data => { data.forEach(d => poner(d.range, d.values)); return ok({}); },
    agregar: (range, values) => { const t = range.split('!')[0]; (T[t] = T[t] || []).push(...values); persistir(t); return ok({}); },
    lote: requests => {
      requests.forEach(rq => {
        if (rq.addSheet) { const t = rq.addSheet.properties.title; T[t] = T[t] || []; nid(t); persistir(t); }
        if (rq.deleteDimension) { const g = rq.deleteDimension.range, t = Object.keys(ID).find(k => ID[k] === g.sheetId); T[t].splice(g.startIndex, g.endIndex - g.startIndex); persistir(t); }
      });
      return ok({});
    },
    puedeEditar: () => ok(puede),
    buscarCarpeta: (nombre) => ok({ id: 'qa-' + nombre, name: nombre }),
    crearCarpeta: (nombre) => ok({ id: 'qa-' + nombre.replace(/\W+/g, '-'), name: nombre })
  };
})();
