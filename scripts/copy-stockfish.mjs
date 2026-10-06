// Copie les binaires Stockfish WASM (paquet npm "stockfish") dans public/stockfish
// afin qu'ils soient servis localement par Vite. Aucun appel réseau à l'exécution.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dst = join(root, 'public', 'stockfish');
// Seules les variantes "lite" (~7 Mo) sont copiées : les variantes complètes font >100 Mo.
const files = [
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
  'stockfish-18-lite.js',
  'stockfish-18-lite.wasm',
];
if (!existsSync(src)) {
  console.warn('[copy-stockfish] node_modules/stockfish introuvable, étape ignorée.');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
for (const f of files) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log(`[copy-stockfish] ${files.length} fichiers copiés dans public/stockfish`);
