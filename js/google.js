/* Login con Google (Google Identity Services) y llamadas a Sheets / Drive con el token del usuario. */
const G = (() => {
  let token = null, expira = 0, cliente = null, pendiente = null, permisosOk = true;
  try { const t = JSON.parse(sessionStorage.getItem('imp-token') || 'null'); if (t && t.expira > Date.now() + 60e3) { token = t.token; expira = t.expira; } } catch (e) {}

  function init() {
    cliente = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID, scope: CONFIG.SCOPES,
      callback: r => {
        const p = pendiente; pendiente = null;
        if (r.error) { p && p.reject(new Error(r.error_description || r.error)); return; }
        token = r.access_token; expira = Date.now() + (r.expires_in - 60) * 1000;
        permisosOk = google.accounts.oauth2.hasGrantedAllScopes(r, ...CONFIG.SCOPES.split(' ').filter(x => x.startsWith('https://')));
        try { sessionStorage.setItem('imp-token', JSON.stringify({ token, expira })); } catch (e) {}
        p && p.resolve(token);
      },
      error_callback: e => { const p = pendiente; pendiente = null; p && p.reject(new Error(e.message || e.type || 'login cancelado')); }
    });
  }
  function pedirToken(prompt) {
    return new Promise((resolve, reject) => { pendiente = { resolve, reject }; cliente.requestAccessToken({ prompt }); });
  }
  const conectado = () => !!token && Date.now() < expira;
  async function login() { return pedirToken('consent select_account'); }
  function logout() {
    if (token) google.accounts.oauth2.revoke(token, () => {});
    token = null; expira = 0; try { sessionStorage.removeItem('imp-token'); } catch (e) {}
  }
  async function api(url, opts = {}, reintento = true) {
    if (!conectado()) await pedirToken('');
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token, ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}) } });
    if (r.status === 401 && reintento) { token = null; await pedirToken(''); return api(url, opts, false); }
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try { const j = await r.json(); msg = j.error?.message || msg; } catch (e) {}
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  const SH = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.SPREADSHEET_ID;
  const DR = 'https://www.googleapis.com/drive/v3/files';
  const q = o => Object.entries(o).map(([k, v]) => Array.isArray(v) ? v.map(x => k + '=' + encodeURIComponent(x)).join('&') : k + '=' + encodeURIComponent(v)).join('&');

  return {
    init, login, logout, conectado, permisosOk: () => permisosOk,
    usuario: () => api('https://www.googleapis.com/oauth2/v3/userinfo'),
    meta: () => api(SH + '?fields=sheets.properties(sheetId,title)'),
    leer: ranges => api(SH + '/values:batchGet?' + q({ ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' })),
    escribir: data => api(SH + '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }),
    agregar: (range, values) => api(SH + '/values/' + encodeURIComponent(range) + ':append?' + q({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }), { method: 'POST', body: JSON.stringify({ values }) }),
    lote: requests => api(SH + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }),
    puedeEditar: async () => (await api(DR + '/' + CONFIG.SPREADSHEET_ID + '?fields=capabilities(canEdit)&supportsAllDrives=true')).capabilities.canEdit,
    buscarCarpeta: async (nombre, padre) => {
      const r = await api(DR + '?' + q({ q: `'${padre}' in parents and name = '${nombre.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true }));
      return r.files[0] || null;
    },
    crearCarpeta: (nombre, padre) => api(DR + '?supportsAllDrives=true&fields=id,name,webViewLink', { method: 'POST', body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padre] }) })
  };
})();
