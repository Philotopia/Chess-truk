// Arène contre Stockfish : quelles valeurs de pièces et de pions font le mieux contre un adversaire extérieur ?
// Stockfish (profondeur fixe, déterministe) sert uniquement d'adversaire étalon ; Truk choisit seul ses coups.
// Chaque variante de Truk (un paramètre modifié) joue N parties contre Stockfish ; la référence aussi, sur les mêmes
// ouvertures. Elo(valeur) est ajusté par une parabole libre (la référence est un point mesuré comme les autres).
// Règle des pions conservée : pion = 100, avancement croissant dans toutes les variantes.
//
// Usage : npm run sf-arena -- [--games 400] [--ref-games 800] [--nodes 4000] [--sf-depth 5] [-j 4] [--verify 1000]
//                             [--resume results/arena/sf-<id>.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EngineConfig, cloneConfig, defaultEngineConfig } from '../src/engine/params';
import { type ArenaPoint, eloWithSe, estimateOptimumFree } from '../src/match/arena';
import { runParallelTournament } from '../src/match/parallel';
import { newId } from '../src/match/tournament';
import { defaultAdjudication } from '../src/match/types';
import { defaultStockfishSettings } from '../src/stockfish/presets';

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const games = Number(arg('games', '400'));
const refGames = Number(arg('ref-games', '800'));
const nodes = Number(arg('nodes', '4000'));
const sfDepth = Number(arg('sf-depth', '5'));
const verifyGames = Number(arg('verify', '1000'));
const j = Number(argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : 4);
const ref: EngineConfig = defaultEngineConfig('Truk');

interface Dim {
  key: string;
  label: string;
  reference: number;
  values: number[];
  apply: (c: EngineConfig, v: number) => void;
}
const pv = ref.eval.pieceValues;
const piece = (k: 'knight' | 'bishop' | 'rook' | 'queen', label: string, offs: number[]): Dim => ({
  key: k,
  label,
  reference: pv[k],
  values: offs.map((o) => pv[k] + o),
  apply: (c, v) => {
    c.eval.pieceValues[k] = v;
  },
});
const rank = (idx: number, values: number[]): Dim => ({
  key: `rank${idx + 1}`,
  label: `Pion en ${idx + 1}e rangée`,
  reference: ref.eval.pawnAdvancement[idx],
  values,
  apply: (c, v) => {
    c.eval.pawnAdvancement[idx] = v;
  },
});
const dims: Dim[] = [
  piece('knight', 'Cavalier', [-80, -40, 40, 80]),
  piece('bishop', 'Fou', [-80, -40, 40, 80]),
  piece('rook', 'Tour', [-120, -60, 60, 120]),
  piece('queen', 'Dame', [-200, -100, 100, 200]),
  // Valeurs compatibles avec la croissance de la table (0, 5, 12, 25, 50, 100).
  rank(4, [12, 18, 35, 50]),
  rank(5, [25, 35, 70, 100]),
  rank(6, [50, 75, 140, 200]),
];

interface SfArenaFile {
  id: string;
  createdAt: string;
  base: EngineConfig;
  conditions: { games: number; refGames: number; nodes: number; sfDepth: number };
  reference?: ArenaPoint;
  points: Record<string, ArenaPoint[]>;
  estimates: Record<string, { a: number; b: number; c: number; optimum: number | null; low: number; high: number; concaveShare: number; reference: number; best: number }>;
  verification?: Record<string, { pieceValues: Record<string, number>; advancement: number[]; games: number; wins: number; draws: number; losses: number; elo: number; se: number }>;
}
const resume = arg('resume');
const file: SfArenaFile =
  resume && existsSync(resume)
    ? JSON.parse(readFileSync(resume, 'utf8'))
    : { id: newId(), createdAt: new Date().toISOString(), base: ref, conditions: { games, refGames, nodes, sfDepth }, points: {}, estimates: {} };
mkdirSync('results/arena', { recursive: true });
const out = `results/arena/sf-${file.id}.json`;
const save = () => writeFileSync(out, JSON.stringify(file, null, 2));

async function vsStockfish(cfg: EngineConfig, label: string, n: number): Promise<ArenaPoint & { offset: number }> {
  const t0 = Date.now();
  const rec = await runParallelTournament(
    {
      name: `${label} vs Stockfish prof. ${file.conditions.sfDepth}`,
      a: { kind: 'truk', label, config: cfg, limits: { nodes: file.conditions.nodes } },
      b: { kind: 'stockfish', label: `Stockfish prof. ${file.conditions.sfDepth}`, settings: defaultStockfishSettings(), limits: { depth: file.conditions.sfDepth } },
      games: n,
      openings: 'random',
      openingOffset: 6000,
      openingSeed: 1,
      maxPlies: 400,
      adjudication: { ...defaultAdjudication(), enabled: true },
    },
    j,
  );
  const s = rec.stats;
  const { elo, se } = eloWithSe(s.wins, s.draws, s.losses);
  console.log(
    `  ${label} : +${s.wins} =${s.draws} -${s.losses} (${(s.score * 100).toFixed(1)} %, ${elo >= 0 ? '+' : ''}${elo.toFixed(0)} Elo vs SF) en ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  return { offset: 0, elo, se, games: s.games, wins: s.wins, draws: s.draws, losses: s.losses };
}

const monotone = (adv: number[]) => {
  const a = [...adv];
  for (let r = 2; r <= 6; r++) if (a[r] < a[r - 1]) a[r] = a[r - 1];
  return a;
};

async function main() {
  const c = file.conditions;
  console.log(`Arène contre Stockfish ${file.id} — Truk ${c.nodes} nœuds/coup contre Stockfish profondeur ${c.sfDepth} ; ${c.games} parties par variante, ${c.refGames} pour la référence`);
  if (!file.reference) {
    console.log('\n== Référence ==');
    file.reference = await vsStockfish(ref, 'Référence', c.refGames);
    save();
  }
  for (const d of dims) {
    file.points[d.key] ??= [];
    console.log(`\n== ${d.label} (référence ${d.reference}) ==`);
    for (const v of d.values) {
      const off = v - d.reference;
      if (file.points[d.key].some((p) => p.offset === off)) continue;
      const cfg = cloneConfig(ref);
      d.apply(cfg, v);
      const p = await vsStockfish(cfg, `${d.label} = ${v}`, c.games);
      file.points[d.key].push({ ...p, offset: off });
      save();
    }
    const pts = [{ ...file.reference!, offset: 0 }, ...file.points[d.key]];
    const est = estimateOptimumFree(pts);
    const lo = Math.min(...d.values) - d.reference;
    const hi = Math.max(...d.values) - d.reference;
    const bestOff = est.optimum === null ? 0 : Math.max(lo, Math.min(hi, est.optimum));
    file.estimates[d.key] = { ...est, reference: d.reference, best: Math.round(d.reference + bestOff) };
    save();
    console.log(
      `  → optimum ${est.optimum === null ? 'non déterminé (courbe non concave)' : Math.round(d.reference + est.optimum)} ; IC95 [${Math.round(d.reference + est.low)} ; ${Math.round(d.reference + est.high)}]`,
    );
  }

  // Vérification : combinaison des optimums contre Stockfish, et référence sur les mêmes ouvertures.
  file.verification ??= {};
  if (verifyGames > 0) {
    const best = cloneConfig(ref);
    for (const k of ['knight', 'bishop', 'rook', 'queen'] as const) best.eval.pieceValues[k] = file.estimates[k].best;
    for (const idx of [4, 5, 6]) best.eval.pawnAdvancement[idx] = file.estimates[`rank${idx + 1}`].best;
    best.eval.pawnAdvancement = monotone(best.eval.pawnAdvancement);
    const runs: [string, EngineConfig][] = [
      ['référence', ref],
      ['optimums de l’arène', best],
    ];
    for (const [name, cfg] of runs) {
      if (file.verification[name]) continue;
      console.log(`\n== Vérification « ${name} » (${verifyGames} parties) ==`);
      const p = await vsStockfish(cfg, name, verifyGames);
      file.verification[name] = { pieceValues: { ...cfg.eval.pieceValues }, advancement: cfg.eval.pawnAdvancement, ...p };
      save();
    }
    const r = file.verification['référence'];
    const b = file.verification['optimums de l’arène'];
    const diff = b.elo - r.elo;
    const se = Math.sqrt(r.se * r.se + b.se * b.se);
    console.log(`\nOptimums − référence (contre Stockfish) : ${diff >= 0 ? '+' : ''}${diff.toFixed(0)} ± ${(1.96 * se).toFixed(0)} Elo`);
  }
  console.log(`\nRésultats : ${out}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
