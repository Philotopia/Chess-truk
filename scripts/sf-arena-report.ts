// Rapport de l'arène contre Stockfish. Usage : npm run sf-arena-report -- results/arena/sf-<id>.json
import { readFileSync, writeFileSync } from 'node:fs';

const f = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = f.conditions;
const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(0);
const pct = (p: { wins: number; draws: number; games: number }) => ((100 * (p.wins + p.draws / 2)) / p.games).toFixed(1) + ' %';
const LABELS: Record<string, string> = {
  knight: 'Cavalier',
  bishop: 'Fou',
  rook: 'Tour',
  queen: 'Dame',
  rank5: 'Pion en 5e rangée',
  rank6: 'Pion en 6e rangée',
  rank7: 'Pion en 7e rangée',
};
const L: string[] = [];
L.push(`# Arène contre Stockfish — ${f.createdAt.slice(0, 10)}`, '');
L.push(
  `Truk (${c.nodes} nœuds par coup) contre Stockfish 18 lite WASM à profondeur ${c.sfDepth} (déterministe). Stockfish n'est qu'un adversaire étalon : Truk choisit seul ses coups.`,
  `${c.games} parties par variante, ${c.refGames} pour la référence, mêmes ouvertures pour tous, couleurs inversées. Règle des pions conservée (pion = 100, avancement croissant).`,
  '',
);
const r = f.reference;
L.push(`**Référence** (valeurs actuelles) : ${pct(r)} contre Stockfish, soit ${sign(r.elo)} ± ${(1.96 * r.se).toFixed(0)} Elo (${r.games} parties).`, '');
L.push('| Paramètre | Actuel | Valeurs testées : Elo contre Stockfish (score) | Optimum | IC95 | Écart vs référence au sommet |', '|---|---|---|---|---|---|');
for (const k of Object.keys(LABELS)) {
  const e = f.estimates[k];
  const pts = f.points[k];
  if (!e || !pts) continue;
  const tested = [...pts]
    .sort((a: { offset: number }, b: { offset: number }) => a.offset - b.offset)
    .map((p: { offset: number; elo: number; wins: number; draws: number; games: number }) => `${e.reference + p.offset} : ${sign(p.elo)} (${pct(p)})`)
    .join(' · ');
  const top = e.optimum === null ? null : e.a + e.b * e.optimum + e.c * e.optimum * e.optimum;
  L.push(
    `| ${LABELS[k]} | ${e.reference} | ${tested} | ${e.optimum === null ? 'non concave' : Math.round(e.reference + e.optimum)} | ${Math.round(e.reference + e.low)} – ${Math.round(e.reference + e.high)} | ${top === null ? '—' : sign(top - r.elo)} |`,
  );
}
L.push('');
if (f.verification && f.verification['référence'] && f.verification['optimums de l’arène']) {
  const a = f.verification['référence'];
  const b = f.verification['optimums de l’arène'];
  const d = b.elo - a.elo;
  const se = Math.sqrt(a.se * a.se + b.se * b.se);
  L.push(
    '## Vérification (mêmes ouvertures)',
    '',
    '| Configuration | Valeurs (C, F, T, D) | Avancement (rangées 2→7) | Résultat contre Stockfish | Elo vs SF |',
    '|---|---|---|---|---|',
  );
  for (const [name, v] of [
    ['Référence', a],
    ['Optimums de l’arène', b],
  ] as const) {
    L.push(
      `| ${name} | ${v.pieceValues.knight}, ${v.pieceValues.bishop}, ${v.pieceValues.rook}, ${v.pieceValues.queen} | ${v.advancement.slice(1, 7).join(', ')} | +${v.wins} =${v.draws} -${v.losses} (${pct(v)}) | ${sign(v.elo)} ± ${(1.96 * v.se).toFixed(0)} |`,
    );
  }
  L.push('', `**Écart optimums − référence contre Stockfish : ${sign(d)} ± ${(1.96 * se).toFixed(0)} Elo.**`, '');
}
const out = `reports/sf-arena-${f.id}.md`;
writeFileSync(out, L.join('\n'));
console.log(`Écrit : ${out}`);
