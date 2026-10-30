/* Configuración pública: ninguno de estos valores da acceso por sí solo.
   El acceso lo da la cuenta Google de cada usuario y sus permisos sobre el Sheets y las carpetas. */
const CONFIG = {
  CLIENT_ID: '386578319162-odgmde577n80i9ph8fhtpmjd3uoae1if.apps.googleusercontent.com',
  SCOPES: 'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
  SPREADSHEET_ID: '1Ah_grqzyxqWicmsOTeZtYb8Cnvgb4bs14IOE7_tefFE', // IMPORTACIONES 2EBOX
  CARPETA_RAIZ_ID: '147LYsW2tFii-nto1MzMpbeOZQWn8fGso',            // carpeta padre de Chimeneas / Telones / Reolink
  // Aplicación web del Apps Script (doGet en Motor.gs): da acceso de solo lectura a quien trae un enlace personal válido.
  WEBAPP_URL: ''
};
