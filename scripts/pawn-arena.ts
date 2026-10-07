// Arène de la valeur des pions selon leur case : rangée (vertical) et colonne (horizontal).
// Truk contre Truk uniquement. Un paramètre à la fois : 4 valeurs × N parties contre la référence, ajustement
// parabolique + bootstrap (comme l'arène des pièces). Règle du projet : toutes les variantes de rangée respectent
// la croissance avec l'avancement ; la valeur retenue est projetée sur une table croissante.
// Enfin, deux candidats sont vérifiés contre la référence : la combinaison de l'arène et la table statistique (Texel).
//
// Usage : npm run pawn-arena -- [--games 300] [--nodes 4000] [-j 4] [--verify 1000] [--resume results/arena/<id>.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EngineConfig, cloneConfig, defaultEngineConfig } from '../src/engine/params';
import { type ArenaEstimate, type ArenaPoint, eloWithSe, estimateOptimum } from '../src/match/arena';
import { runParallelTournament } from '../src/match/parallel';
import { newId } from '../src/match/tournament';
import { defaultAdjudication } from '../src/match/types';

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const games = Number(arg('games', '300'));
const nodes = Number(arg('nodes', '4000'));
const verifyGames = Number(arg('verify', '1000'));
const j = Number(argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : 4);
const ref: EngineConfig = defaultEngineConfig('Référence');
const ADV = ref.eval.pawnAdvancement;

interface Dim {
  key: string;
  label: string;
  reference: number;
  values: number[];
  apply: (c: EngineConfig, v: number) => void;
}
const FILES: [string, number[]][] = [
  ['a/h', [0, 7]],
  ['b/g', [1, 6]],
  ['c/f', [2, 5]],
  ['d/e', [3, 4]],
];
// Valeurs testées par rangée, toutes compatibles avec la croissance (table de référence 0, 5, 12, 25, 50, 100).
const RANK_VALUES: Record<number, number[]> = { 2: [0, 2, 9, 12], 3: [5, 8, 18, 25], 4: [12, 18, 35, 50], 5: [25, 35, 70, 100], 6: [50, 75, 140, 200] };
const dims: Dim[] = [
  ...[2, 3, 4, 5, 6].map((idx) => ({
    key: `rank${idx + 1}`,
    label: `Rangée ${idx + 1}`,
    reference: ADV[idx],
    values: RANK_VALUES[idx],
    apply: (c: EngineConfig, v: number) => {
      c.eval.pawnAdvancement[idx] = v;
    },
  })),
  ...FILES.map(([name, fs]) => ({
    key: `file-${name}`,
    label: `Colonnes ${name}`,
    reference: 0,
    values: [-30, -15, 15, 30],
    apply: (c: EngineConfig, v: number) => {
      for (const f of fs) c.eval.pawnFile[f] = v;
    },
  })),
];

interface PawnArenaFile {
  id: string;
  createdAt: string;
  base: EngineConfig;
  conditions: { games: number; nodes: number };
  points: Record<string, ArenaPoint[]>;
  estimates: Record<string, ArenaEstimate & { reference: number; best: number }>;
  candidates?: Record<string, { advancement: number[]; files: number[]; games: number; wins: number; draws: number; losses: number; elo: number; se: number }>;
}
const resume = arg('resume');
const file: PawnArenaFile =
  resume && existsSync(resume)
    ? JSON.parse(readFileSync(resume, 'utf8'))
    : { id: newId(), createdAt: new Date().toISOString(), base: ref, conditions: { games, nodes }, points: {}, estimates: {} };
mkdirSync('results/arena', { recursive: true });
const out = `results/arena/pawns-${file.id}.json`;
const save = () => writeFileSync(out, JSON.stringify(file, null, 2));

async function match(challenger: EngineConfig, label: string, n: number) {
  const t0 = Date.now();
  const rec = await runParallelTournament(
    {
      name: label,
      a: { kind: 'truk', label, config: challenger, limits: { nodes } },
      b: { kind: 'truk', label: 'Référence', config: ref, limits: { nodes } },
      games: n,
      openings: 'random',
      openingOffset: 3000,
      openingSeed: 1,
      maxPlies: 400,
      adjudication: { ...defaultAdjudication(), enabled: true },
    },
    j,
  );
  const s = rec.stats;
  console.log(`  ${label} : +${s.wins} =${s.draws} -${s.losses} (${(s.score * 100).toFixed(1)} %) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { w: s.wins, d: s.draws, l: s.losses };
}

function monotone(adv: number[]): number[] {
  const a = [...adv];
  for (let r = 2; r <= 6; r++) if (a[r] < a[r - 1]) a[r] = a[r - 1];
  return a;
}

async function main() {
  console.log(`Arène des pions ${file.id} — ${games} parties par point, ${nodes} nœuds/coup ; avancement de référence ${ADV.join(', ')}`);
  for (const d of dims) {
    file.points[d.key] ??= [];
    console.log(`\n== ${d.label} (référence ${d.reference}) ==`);
    for (const v of d.values) {
      const off = v - d.reference;
      if (file.points[d.key].some((p) => p.offset === off)) continue;
      const c = cloneConfig(ref);
      d.apply(c, v);
      const r = await match(c, `${d.label} = ${v}`, games);
      const { elo, se } = eloWithSe(r.w, r.d, r.l);
      file.points[d.key].push({ offset: off, elo, se, games: r.w + r.d + r.l, wins: r.w, draws: r.d, losses: r.l });
      save();
    }
    const est = estimateOptimum(file.points[d.key]);
    const lo = Math.min(...d.values) - d.reference;
    const hi = Math.max(...d.values) - d.reference;
    const bestOff = est.optimum === null ? 0 : Math.max(lo, Math.min(hi, est.optimum));
    file.estimates[d.key] = { ...est, reference: d.reference, best: Math.round(d.reference + bestOff) };
    save();
    console.log(
      `  → optimum ${est.optimum === null ? 'non déterminé (courbe non concave) : référence conservée' : Math.round(d.reference + est.optimum)}` +
        ` ; IC95 [${Math.round(d.reference + est.low!)} ; ${Math.round(d.reference + est.high!)}]`,
    );
  }

  // Candidats.
  file.candidates ??= {};
  const arenaAdv = monotone(ADV.map((v, i) => (i >= 2 && i <= 6 ? file.estimates[`rank${i + 1}`].best : v)));
  const arenaFiles = new Array(8).fill(0);
  for (const [name, fs] of FILES) for (const f of fs) arenaFiles[f] = file.estimates[`file-${name}`].best;
  const cands: Record<string, { advancement: number[]; files: number[] }> = { arène: { advancement: arenaAdv, files: arenaFiles } };
  if (existsSync('reports/pawn-values-texel.json')) {
    const tx = JSON.parse(readFileSync('reports/pawn-values-texel.json', 'utf8'));
    const t: number[][] = tx.results['rangée + colonne (monotone : règle des pions)'].table;
    const adv = [0, 0, ...t.slice(1).map((row) => Math.round(row[0])), 0];
    const sym = t[0].map((x) => Math.round(x));
    cands['statistique (Texel)'] = { advancement: monotone(adv), files: [sym[0], sym[1], sym[2], sym[3], sym[3], sym[2], sym[1], sym[0]] };
  }
  for (const [name, c] of Object.entries(cands)) {
    if (file.candidates[name] || verifyGames <= 0) continue;
    console.log(`\n== Vérification « ${name} » : avancement ${c.advancement.join(', ')} ; colonnes ${c.files.join(', ')} ==`);
    const cfg = cloneConfig(ref);
    cfg.eval.pawnAdvancement = c.advancement;
    cfg.eval.pawnFile = c.files;
    const r = await match(cfg, name, verifyGames);
    const { elo, se } = eloWithSe(r.w, r.d, r.l);
    file.candidates[name] = { ...c, games: r.w + r.d + r.l, wins: r.w, draws: r.d, losses: r.l, elo, se };
    save();
    console.log(`  → ${elo >= 0 ? '+' : ''}${elo.toFixed(0)} ± ${(1.96 * se).toFixed(0)} Elo (IC95)`);
  }
  console.log(`\nRésultats : ${out}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
