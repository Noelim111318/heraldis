#!/usr/bin/env node
/* Genere regles-heraldis.pdf (a la racine de l'app) a partir de l'ecran des
 * regles de l'app : meme texte, meme plateau, sans la section « Dans
 * l'application » (.rules-app). Mise en page A4 sur papier clair.
 *
 *   node tools/make-rules-pdf.js
 *
 * Necessite Playwright (Chromium) : npm i playwright  (ou NODE_PATH vers un
 * node_modules qui le contient). A relancer quand le texte des regles change,
 * puis ./tools/bump-version.sh (le PDF est dans APP_SHELL).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright requis :  npm i playwright   (ou NODE_PATH=<dossier node_modules>)');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'regles-heraldis.pdf');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

// Styles d'impression : papier clair, encre sombre, titres dores fonces.
const PRINT_CSS = `
@page { size: A4; margin: 12mm 16mm 14mm; }
html, body { background: #FFFFFF !important; color: #2A2118 !important; }
body { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; padding: 0 !important; }
body::before { display: none !important; }
.print-head { text-align: center; margin-bottom: 2mm; }
.print-head h1 { font-family: 'Cinzel', serif; font-weight: 900; font-size: 26pt; color: #8A6414; letter-spacing: 1pt; }
.print-head p { font-size: 11pt; color: #6B5E4A; margin-top: 1mm; }
.rules { background: none !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
.rules h2 { display: none; }
.rules h3 { font-family: 'Cinzel', serif; color: #8A6414 !important; font-size: 12.5pt; margin: 3.5mm 0 1mm !important; break-after: avoid; }
.rules p, .rules li { color: #2A2118 !important; font-size: 10.5pt; line-height: 1.45; }
.rules strong { color: #140E08 !important; }
.rules .rules-meta { color: #6B5E4A !important; font-size: 10pt !important; text-align: center; }
.rules .example { background: #F1E7D2 !important; border-left-color: #B88A2E !important; }
.crest-img { width: 1.35em; height: 1.35em; vertical-align: -0.35em; }
.board-img { display: block; width: 62mm; height: 62mm; margin: 2mm auto 1mm; break-inside: avoid; border-radius: 2.2mm; }
`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 3, viewport: { width: 390, height: 900 } })).newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  // Le plateau (filtres SVG de grain) est capture une fois en image : sinon le
  // PDF embarque les textures en tres haute definition (plusieurs Mo).
  await page.evaluate(() => window.AppEngine.screens.show('screen-rules'));
  await page.waitForTimeout(300);
  await page.addStyleTag({ content: 'html,body,#screen-rules,.rules{background:#FFFFFF!important} body::before{display:none!important}' });
  const png = (await page.locator('#rules-board').screenshot({ scale: 'device', type: 'jpeg', quality: 86 })).toString('base64');
  // Emblemes du texte : images dorees (le masque CSS laisse un trait parasite en PDF)
  const crests = await page.evaluate(async () => {
    const out = {};
    for (const n of ['loup', 'aigle', 'ours', 'cerf', 'sanglier']) {
      const im = new Image(); im.src = 'crests/' + n + '.png'; await im.decode();
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 96, 96);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#A87C22'; g.fillRect(0, 0, 96, 96);
      out[n] = c.toDataURL('image/png');
    }
    return out;
  });
  await page.evaluate(([css, png, crests]) => {
    document.querySelector('meta[name="color-scheme"]').setAttribute('content', 'light');
    const rules = document.querySelector('.rules').cloneNode(true);
    const img = document.createElement('img');
    img.className = 'board-img';
    img.src = 'data:image/jpeg;base64,' + png;
    rules.querySelector('#rules-board').replaceWith(img);
    rules.querySelectorAll('.crest--inline').forEach((sp) => {
      const n = (sp.className.match(/crest--(loup|aigle|ours|cerf|sanglier)/) || [])[1];
      const ci = document.createElement('img');
      ci.className = 'crest-img'; ci.alt = ''; ci.src = crests[n];
      sp.replaceWith(ci);
    });
    rules.querySelectorAll('.rules-app').forEach((n) => n.remove());
    const sprites = Array.from(document.querySelectorAll('body > svg')).map((s) => s.outerHTML).join('');
    document.body.className = '';
    document.body.innerHTML = sprites +
      '<header class="print-head"><h1>⚜ Heraldis</h1><p>Règles du jeu</p></header>';
    document.body.appendChild(rules);
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }, [PRINT_CSS, png, crests]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;text-align:center;font:8pt sans-serif;color:#8A7A60">'
      + 'Heraldis — règles du jeu · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  });
  await browser.close();
  srv.close();
  console.log('PDF ecrit :', OUT, '(' + Math.round(fs.statSync(OUT).size / 1024) + ' Ko)');
})();
