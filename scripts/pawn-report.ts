// Rapport « valeur des pions selon la case » : statistiques (Texel) + arène + vérifications.
// Usage : npm run pawn-report -- results/arena/pawns-<id>.json
import { readFileSync, writeFileSync } from 'node:fs';
import { FILE_NAMES } from '../src/engine/pawnModel';

const arenaFile = process.argv[2];
const arena = JSON.parse(readFileSync(arenaFile, 'utf8'));
const tx = JSON.parse(readFileSync('reports/pawn-values-texel.json', 'utf8'));
const L: string[] = [];
const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(0);

L.push(`# Valeur des pions selon leur case — ${arena.createdAt.slice(0, 10)}`, '');
L.push(
  'Question : quelle valeur donner à un pion selon sa **rangée** (vertical, avancement) et sa **colonne** (horizontal) ?',
  'Règle du projet : à colonne égale, un pion plus avancé ne vaut jamais moins (croissance avec l’avancement). Pion en a2 = 100.',
  'Deux méthodes indépendantes, toutes deux sans Stockfish : estimation statistique sur des parties Truk contre Truk, puis arène de parties.',
  '',
);

L.push('## 1. Estimation statistique (méthode Texel)', '');
L.push(
  `${tx.positions.toLocaleString('fr-FR')} positions calmes issues de parties Truk contre Truk ; le reste de l’évaluation est figé, seule la contribution « position des pions » est réestimée pour prédire le résultat des parties. Erreur de validation (10 % des données mises de côté) : table actuelle ${tx.current.valError.toFixed(6)}.`,
  '',
);
for (const [name, r] of Object.entries<{ table: number[][]; valError: number }>(tx.results)) {
  L.push(`### ${name} — erreur de validation ${r.valError.toFixed(6)}`, '', `| Rangée | ${FILE_NAMES.join(' | ')} |`, '|---|---|---|---|---|');
  for (let rel = 6; rel >= 1; rel--) L.push(`| ${rel + 1} | ${r.table[rel - 1].map((x) => sign(x)).join(' | ')} |`);
  L.push('');
}

L.push('## 2. Arène (parties)', '');
L.push(
  `Un paramètre à la fois, ${arena.conditions.games} parties par valeur testée contre la référence, ${arena.conditions.nodes} nœuds par coup, ouvertures figées, couleurs inversées. Valeurs en centipawns ajoutées à la valeur de base du pion (100).`,
  '',
);
const labels: Record<string, string> = {};
for (let r = 3; r <= 7; r++) labels[`rank${r}`] = `Rangée ${r}`;
for (const f of FILE_NAMES) labels[`file-${f}`] = `Colonnes ${f}`;
L.push('| Paramètre | Référence | Valeurs testées (Elo vs référence) | Optimum estimé | IC95 | Retenu |', '|---|---|---|---|---|---|');
for (const key of Object.keys(labels)) {
  const pts = arena.points[key];
  const e = arena.estimates[key];
  if (!pts || !e) continue;
  const ref = e.reference;
  const tested = [...pts]
    .sort((a: { offset: number }, b: { offset: number }) => a.offset - b.offset)
    .map((p: { offset: number; elo: number; se: number }) => `${ref + p.offset} (${sign(p.elo)} ± ${(1.96 * p.se).toFixed(0)})`)
    .join(', ');
  L.push(
    `| ${labels[key]} | ${ref} | ${tested} | ${e.optimum === null ? 'non concave' : Math.round(ref + e.optimum)} | ${Math.round(ref + e.low)} – ${Math.round(ref + e.high)} | ${e.best} |`,
  );
}
L.push('');

if (arena.candidates) {
  L.push('## 3. Vérification des candidats contre la table actuelle', '', '| Candidat | Avancement (rangées 2→7) | Colonnes a→h | Résultat | Elo (IC95) |', '|---|---|---|---|---|');
  for (const [name, c] of Object.entries<{ advancement: number[]; files: number[]; wins: number; draws: number; losses: number; elo: number; se: number; games: number }>(arena.candidates)) {
    L.push(
      `| ${name} | ${c.advancement.slice(1, 7).join(', ')} | ${c.files.join(', ')} | +${c.wins} =${c.draws} -${c.losses} (${c.games}) | **${sign(c.elo)} ± ${(1.96 * c.se).toFixed(0)}** |`,
    );
  }
  L.push('');
}
const out = 'reports/pawn-values.md';
writeFileSync(out, L.join('\n'));
console.log(`Écrit : ${out}`);
