/* Acceso por enlace personal (sin iniciar sesión con Google).
   Si la URL trae ?k=<clave> (el botón del reporte mensual), reemplaza las llamadas de `G` por la
   aplicación web del Apps Script (CONFIG.WEBAPP_URL), que valida la clave contra la pestaña BD_Accesos
   y devuelve los datos en SOLO LECTURA. Sin clave válida no se muestra nada.
   La clave queda guardada en este navegador para volver a entrar sin el correo; "Salir" la borra. */
(() => {
  const CLAVE = 'imp-enlace';
  let k = new URLSearchParams(location.search).get('k');
  if (k) {
    try { localStorage.setItem(CLAVE, k); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.hash);
  } else {
    try { k = localStorage.getItem(CLAVE); } catch (e) {}
  }
  if (!k || !CONFIG.WEBAPP_URL) return;
  window.ENTORNO = 'ENLACE';

  let tablas = {}, yo = null, leido = 0;
  const olvidar = () => { try { localStorage.removeItem(CLAVE); } catch (e) {} };
  async function traer() {
    let j;
    try { j = await (await fetch(CONFIG.WEBAPP_URL + '?k=' + encodeURIComponent(k))).json(); }
    catch (e) { throw new Error('No se pudo conectar con el servidor de la app. Revisa tu conexión y vuelve a intentar.'); }
    if (!j.ok) { olvidar(); const e = new Error('sin_acceso'); e.sinAcceso = true; throw e; }
    tablas = j.tablas || {}; yo = j.usuario; leido = Date.now();
  }
  const col = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  function rango(r) {
    const [t, a1] = r.split('!'), rows = tablas[t] || [];
    const m = a1.match(/^([A-Z]+):([A-Z]+)$/);
    if (m) { const a = col(m[1]), b = col(m[2]); return rows.map(x => x.slice(a, b + 1)); }
    const f = a1.match(/^(\d+):(\d+)$/); if (f) return rows.slice(+f[1] - 1, +f[2]);
    return rows;
  }
  const soloLectura = () => Promise.reject(new Error('Acceso por enlace: solo lectura.'));
  Object.assign(G, {
    init: traer,
    login: () => Promise.resolve(),
    logout: olvidar,
    conectado: () => true,
    permisosOk: () => true,
    usuario: () => Promise.resolve(yo),
    // Todas las pestañas del esquema "existen" para que la app no pida crear la base.
    meta: () => Promise.resolve({ sheets: Object.keys(SCHEMA).map((t, i) => ({ properties: { title: t, sheetId: i } })) }),
    leer: async ranges => {
      if (Date.now() - leido > 20e3) await traer();   // "Actualizar" vuelve a leer el Sheets
      return { valueRanges: ranges.map(r => ({ range: r, values: rango(r) })) };
    },
    escribir: soloLectura, agregar: soloLectura, lote: soloLectura,
    puedeEditar: () => Promise.resolve(false),
    buscarCarpeta: soloLectura, crearCarpeta: soloLectura
  });
})();
