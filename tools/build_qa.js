/* Arma la versión QA en un solo archivo para el artifact de Claude: mismo código que producción,
   pero con js/qa.js en lugar de js/google.js (datos en la base del artifact, sin login de Google).
   Uso: node tools/build_qa.js  →  dist/qa.html */
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(R, f), 'utf8');
const idx = leer('index.html');
const logo = idx.match(/<img src="([^"]+)"/)[1];
const shell = idx.slice(idx.indexOf('<div class="shell">'), idx.indexOf('<script'));
const js = ['js/config.js', 'js/schema.js', 'js/qa.js', 'js/store.js', 'js/app.js']
  .map(f => `<script>/* ${f} */\n${leer(f).replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
const out = `<meta charset="utf-8">
<script>document.documentElement.setAttribute('data-theme','light')</script>
<title>Importaciones QA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${leer('css/app.css')}
</style>
${shell.replace('{{LOGO}}', logo)}
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
${js}
`;
fs.mkdirSync(path.join(R, 'dist'), { recursive: true });
fs.writeFileSync(path.join(R, 'dist', 'qa.html'), out);
console.log('dist/qa.html', out.length, 'bytes');
