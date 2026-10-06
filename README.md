# Importaciones retail.cl

App web para las importaciones de 2ebox / Retail.cl. Reúne en un solo lugar:

- la ficha de cada importación (costeo proyectado vs real, factor, ventas por portal);
- el flujo de caja de pagos;
- la reposición por SKU;
- los correos y documentos de cada importación.

Publicada en **https://jtunon-dev.github.io/importaciones/**.

Este repositorio es público y **no contiene datos del negocio**. Los datos viven en el Sheets *IMPORTACIONES 2EBOX* y en las carpetas de Drive. Cada persona entra con su cuenta de Google y ve o edita lo mismo que puede ver o editar en ese Sheets.

## Cómo funciona

```
Gmail ──► Motor (Apps Script, cada 15 min) ──► Sheets: pestañas BD_*  ◄──► App (GitHub Pages)
               │                                    ▲
               └──► Carpetas de Drive (adjuntos) ───┘ (BD_Documentos)
```

| Pestaña | Contenido | Quién la escribe |
|---|---|---|
| BD_Importaciones | Una fila por importación: datos, fechas, T/C, factor, estado | App (y Jorge a mano) |
| BD_Costeo | Costeo PROYECTADO y REAL por importación | App |
| BD_Productos | Mix de productos y precio por portal | App |
| BD_Pagos | Calendario de pagos, reales y estimados | App |
| BD_Documentos | Archivos de cada carpeta, clasificados | Motor |
| BD_Correos | Correos de órdenes, pagos, DIN y arribos | Motor (la app los asigna) |
| BD_Stock | Stock y ventas por SKU (Defontana) | Carga manual o script |
| BD_Config | T/C de referencia, supuestos, comisiones, consulta de Gmail | App / a mano |
| BD_Log | Quién cambió qué y cuándo | App y motor |

Las pestañas de cálculo de cada importación (Chimenea 1, Telones 3, etc.) no se tocan. Se pueden editar libremente.

## Permisos

Los permisos son los mismos del Sheets y de las carpetas de Drive:

| Permiso en el Sheets | En la app |
|---|---|
| **Editor** | Edita: crea importaciones, cambia costeos y registra pagos e hitos |
| **Lector** | Ve todo en modo solo lectura |

Para dar acceso a alguien, comparte el Sheets (y la carpeta raíz de importaciones) con su cuenta.

## Instalación (una sola vez)

1. **Login de Google.** Proyecto *Importaciones 2ebox* en Google Cloud, con un cliente OAuth web. Orígenes autorizados: `https://jtunon-dev.github.io` y `http://localhost:8080`. El ID del cliente está en `js/config.js`.
2. **GitHub Pages.** En el repositorio, entra a Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
3. **Base en el Sheets.** La primera vez que un editor entra a la app, esta ofrece crear las pestañas BD_*. Se pueden crear vacías o con el archivo `semilla_app.json`, que tiene los datos validados y se guarda fuera de este repositorio.
4. **Motor.**
   1. En el Sheets, abre Extensiones → Apps Script.
   2. Crea el archivo `Motor.gs` y pega ahí el contenido de [`apps-script/Motor.gs`](apps-script/Motor.gs).
   3. Ejecuta `instalar()` una vez y autoriza el acceso.
   4. Desde ese momento el motor corre solo cada 15 minutos.

## Desarrollo local

```
python -m http.server 8080
```

Después abre http://localhost:8080. El login funciona porque ese origen está autorizado en el cliente OAuth.

`tools/seed.js` genera la semilla a partir del mockup validado:

```
node tools/seed.js <mockup.html> <salida.json>
```

La salida contiene datos del negocio: **no la subas a este repositorio**.

## Ambientes: QA y producción

| Ambiente | Dónde | Datos |
|---|---|---|
| **QA** | Artifact de Claude: https://claude.ai/artifact/V9dkQ9jY86NmJixMTgVXX8 (privado) | Copia de prueba guardada en la base del artifact. **No toca el Sheets.** Se reinicia con el botón "Reiniciar QA". |
| **Producción** | https://jtunon-dev.github.io/importaciones/ | Sheets IMPORTACIONES 2EBOX, con el login de Google de cada usuario |

Ambos ambientes usan el mismo código. La única diferencia es la capa de datos:
- QA usa `js/qa.js` (base del artifact, sin login).
- Producción usa `js/google.js` (Sheets y Drive con OAuth).

Flujo de un cambio:
1. Se edita el código en `js/` y `css/`.
2. `node tools/build_qa.js` genera `dist/qa.html`, que se publica en el artifact de QA.
3. Jorge lo prueba en QA.
4. Si lo aprueba ("pasar a producción"), se hace `git push` a `main` y GitHub Pages lo publica.
