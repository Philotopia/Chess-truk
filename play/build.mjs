// Construit la page autonome « Jouer contre Truk » (un seul fichier HTML, moteur inclus).
// Usage : npm run build:play -- [sortie.html]   (défaut : dist-play/truk-play.html)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? 'dist-play/truk-play.html');

async function bundle(entry) {
  const r = await build({
    entryPoints: [resolve(here, entry)],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: true,
    write: false,
    legalComments: 'none',
  });
  // Empêche une fermeture prématurée de la balise <script>.
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

const [worker, main] = await Promise.all([bundle('worker.ts'), bundle('main.ts')]);
const html = readFileSync(resolve(here, 'template.html'), 'utf8')
  .replace('<!--WORKER-->', () => `<script id="truk-worker" type="text/plain">${worker}</script>`)
  .replace('<!--MAIN-->', () => `<script>${main}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Écrit : ${out} (${(html.length / 1024).toFixed(0)} Ko)`);
