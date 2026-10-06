// Génère la suite fixe d'ouvertures aléatoires équilibrées (src/match/openingSuite.json).
// Usage : npm run gen-openings -- 1000
import { writeFileSync } from 'node:fs';
import { randomOpening } from '../src/match/openings';

const n = Number(process.argv[2] ?? 1000);
const out: { name: string; moves: string[] }[] = [];
for (let i = 0; i < n; i++) out.push(randomOpening(i, 20261006));
writeFileSync('src/match/openingSuite.json', JSON.stringify(out));
console.log(`${out.length} ouvertures écrites`);
