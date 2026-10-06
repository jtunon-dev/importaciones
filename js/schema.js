/* Estructura de las pestañas BD_* del Sheets IMPORTACIONES 2EBOX.
   La fila 1 de cada pestaña tiene estos encabezados; el orden de las columnas da lo mismo
   (se leen por nombre), pero no hay que renombrarlas. */
(function (g) {
  const SCHEMA = {
    BD_Importaciones: ['id', 'linea', 'proveedor', 'estado', 'ref', 'ref_klog', 'descripcion', 'tipo', 'via', 'pol', 'incoterm',
      'unidades', 'fob_usd', 'flete_usd', 'pedido', 'zarpe', 'zarpe_est', 'eta_inicial', 'eta', 'eta_est', 'din', 'din_est', 'din_n',
      'bodega', 'bodega_est', 'cd_fuente', 'set_n', 'carpeta', 'carpeta_id', 'pestana', 'anticipo_pct', 'balance',
      'tc_hoy', 'tc_aduana', 'tc_real', 'tc_pagos', 'iva_usd', 'proyectar_con', 'ajuste_usd', 'margen_nn', 'portales_json',
      'factor_proy', 'factor_real', 'factor_calidad', 'factor_nota', 'alerta', 'cotizacion_json', 'actualizado', 'actualizado_por',
      // agregadas después de la carga inicial (la app las crea al final de la fila 1 si faltan)
      'tc_proy', 'tc_hoy_fecha'],
    // Una fila por importación y columna del costeo (PROYECTADO / REAL). Gastos en CLP.
    BD_Costeo: ['id', 'columna', 'fob_clp', 'flete_usd', 'flete_clp', 'seguro_usd', 'seguro_clp', 'iva_clp',
      'origen', 'adicionales', 'almacenaje', 'despacho', 'aga', 'embarcador', 'garantia', 'bodega', 'otros', 'respaldo'],
    // Mix de productos de cada importación y precio de venta por portal.
    BD_Productos: ['id', 'sku', 'nombre', 'unidades', 'fob_unit_usd', 'pvp_shopify', 'pvp_meli', 'pvp_fala', 'pvp_walmart',
      'envio_shopify', 'envio_meli', 'envio_fala', 'envio_walmart'],
    // Calendario de pagos (real y proyectado).
    BD_Pagos: ['pago_id', 'importacion', 'fecha', 'tipo', 'concepto', 'moneda', 'monto', 'tc', 'fuente', 'fecha_estimada', 'respaldo', 'creado_por'],
    // Lo escribe el motor (Apps Script) al revisar las carpetas de Drive.
    BD_Documentos: ['importacion', 'tipo', 'archivo', 'file_id', 'url', 'modificado'],
    // Lo escribe el motor al revisar Gmail; la app solo cambia importacion/estado.
    BD_Correos: ['thread_id', 'fecha', 'de', 'asunto', 'importacion', 'tipo', 'adjuntos', 'estado', 'link'],
    // Stock y ventas por SKU (Defontana, empresa 2EBOX SPA).
    BD_Stock: ['linea', 'sku', 'nombre', 'stock', 'valor_clp', 'fob_usd', 'nuevo', 'descontinuado',
      'v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'v07', 'v08', 'v09', 'v10', 'v11', 'v12'],
    BD_Config: ['clave', 'valor', 'nota'],
    BD_Log: ['fecha', 'usuario', 'accion', 'importacion', 'detalle']
  };
  const TIPOS_DOC = ['PI', 'Invoice', 'Packing list', 'BL', 'DIN', 'Swift', 'Set importación'];
  const GASTOS_K = ['origen', 'adicionales', 'almacenaje', 'despacho', 'aga', 'embarcador', 'garantia', 'bodega', 'otros'];
  g.SCHEMA = SCHEMA; g.TIPOS_DOC = TIPOS_DOC; g.GASTOS_K = GASTOS_K;
})(typeof window !== 'undefined' ? window : globalThis);
