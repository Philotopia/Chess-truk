// Arène des valeurs unitaires des pièces (Truk contre Truk, aucun Stockfish).
//
// Pour chaque pièce, des variantes « valeur de référence + décalage » affrontent la configuration de référence
// sur des centaines de parties (mêmes ouvertures pour tous les points, couleurs inversées). On ajuste ensuite
// Elo(décalage) par une parabole et on en déduit la valeur optimale avec un intervalle de confiance (bootstrap).
// Enfin, la configuration combinant les valeurs optimales est vérifiée contre la référence.
//
// Règle du projet conservée dans TOUTES les variantes : pion = 100 (unité), table d'avancement des pions inchangée
// (les pions avancés valent beaucoup plus), bonus de pion passé inchangés.
//
// Usage : npm run arena -- [--games 300] [--nodes 6000] [-j 4] [--pieces knight,bishop,rook,queen] [--verify 600]
//                          [--config configs/truk-v2.json] [--resume results/arena/<id>.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EngineConfig, cloneConfig, defaultEngineConfig, normalizeConfig } from '../src/engine/params';
import { type ArenaEstimate, type ArenaPoint, eloWithSe, estimateOptimum } from '../src/match/arena';
import { runParallelTournament } from '../src/match/parallel';
import { type TournamentConfig, newId } from '../src/match/tournament';
import { defaultAdjudication } from '../src/match/types';

type Piece = 'knight' | 'bishop' | 'rook' | 'queen';
const FR: Record<Piece, string> = { knight: 'Cavalier', bishop: 'Fou', rook: 'Tour', queen: 'Dame' };
const OFFSETS: Record<Piece, number[]> = {
  knight: [-80, -40, 40, 80],
  bishop: [-80, -40, 40, 80],
  rook: [-120, -60, 60, 120],
  queen: [-200, -100, 100, 200],
};

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const games = Number(arg('games', '300'));
const nodes = Number(arg('nodes', '6000'));
const verifyGames = Number(arg('verify', '600'));
const j = Number(argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : 4);
const pieces = (arg('pieces', 'knight,bishop,rook,queen') as string).split(',') as Piece[];
const base: EngineConfig = arg('config') ? normalizeConfig(JSON.parse(readFileSync(arg('config')!, 'utf8'))) : defaultEngineConfig('Truk V2');

interface ArenaFile {
  id: string;
  createdAt: string;
  base: EngineConfig;
  conditions: { games: number; nodes: number; openings: string; adjudication: unknown };
  points: Record<string, ArenaPoint[]>;
  estimates: Record<string, ArenaEstimate & { reference: number; best: number }>;
  verification?: { config: Record<string, number>; games: number; wins: number; draws: number; losses: number; elo: number; se: number };
}

const resume = arg('resume');
const file: ArenaFile =
  resume && existsSync(resume)
    ? (JSON.parse(readFileSync(resume, 'utf8')) as ArenaFile)
    : {
        id: newId(),
        createdAt: new Date().toISOString(),
        base,
        conditions: { games, nodes, openings: 'suite figée, décalage 3000', adjudication: 'abandon ±1000 cp / 4 coups, nulle ±10 cp / 12 coups après 80 ½-coups' },
        points: {},
        estimates: {},
      };
mkdirSync('results/arena', { recursive: true });
const out = `results/arena/${file.id}.json`;
const save = () => writeFileSync(out, JSON.stringify(file, null, 2));

// Vérification de la règle des pions.
const ref = file.base;
if (ref.eval.pieceValues.pawn !== 100) throw new Error('Règle : le pion doit valoir 100 (unité).');
for (let r = 2; r <= 6; r++) {
  if (!(ref.eval.pawnAdvancement[r] > ref.eval.pawnAdvancement[r - 1])) throw new Error('Règle : l’avancement des pions doit être croissant.');
}

async function match(challenger: EngineConfig, label: string, n: number): Promise<{ w: number; d: number; l: number }> {
  const t0 = Date.now();
  const config: TournamentConfig = {
    name: label,
    a: { kind: 'truk', label: challenger.name, config: challenger, limits: { nodes } },
    b: { kind: 'truk', label: ref.name, config: ref, limits: { nodes } },
    games: n,
    openings: 'random',
    openingOffset: 3000,
    openingSeed: 1,
    maxPlies: 400,
    adjudication: { ...defaultAdjudication(), enabled: true },
  };
  const rec = await runParallelTournament(config, j);
  const s = rec.stats;
  console.log(`  ${label} : +${s.wins} =${s.draws} -${s.losses} (${(s.score * 100).toFixed(1)} %) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { w: s.wins, d: s.draws, l: s.losses };
}

function variant(changes: Partial<Record<Piece, number>>, name: string): EngineConfig {
  const c = cloneConfig(ref);
  c.name = name;
  for (const [k, v] of Object.entries(changes)) c.eval.pieceValues[k as Piece] = v!;
  return c;
}

async function main() {
  console.log(`Arène ${file.id} — référence : C ${ref.eval.pieceValues.knight}, F ${ref.eval.pieceValues.bishop}, T ${ref.eval.pieceValues.rook}, D ${ref.eval.pieceValues.queen} ; ${games} parties par point, ${nodes} nœuds/coup, ${j} en parallèle`);
  console.log(`Règle des pions : avancement ${ref.eval.pawnAdvancement.join(', ')} (inchangé dans toutes les variantes)`);
  for (const p of pieces) {
    const refVal = ref.eval.pieceValues[p];
    file.points[p] ??= [];
    console.log(`\n== ${FR[p]} (référence ${refVal}) ==`);
    for (const off of OFFSETS[p]) {
      if (file.points[p].some((x) => x.offset === off)) continue;
      const r = await match(variant({ [p]: refVal + off }, `${FR[p]} ${refVal + off}`), `${FR[p]} = ${refVal + off}`, games);
      const { elo, se } = eloWithSe(r.w, r.d, r.l);
      file.points[p].push({ offset: off, elo, se, games: r.w + r.d + r.l, wins: r.w, draws: r.d, losses: r.l });
      save();
    }
    const est = estimateOptimum(file.points[p]);
    const lo = Math.min(...OFFSETS[p]);
    const hi = Math.max(...OFFSETS[p]);
    const bestOff = est.optimum === null ? (est.b >= 0 ? hi : lo) : Math.max(lo, Math.min(hi, est.optimum));
    file.estimates[p] = { ...est, reference: refVal, best: Math.round(refVal + bestOff) };
    save();
    console.log(
      `  → optimum estimé ${est.optimum === null ? 'hors plage (courbe non concave)' : Math.round(refVal + est.optimum)}` +
        ` ; IC95 [${Math.round(refVal + est.low!)} ; ${Math.round(refVal + est.high!)}] ; parabole concave dans ${(est.concaveShare * 100).toFixed(0)} % des tirages`,
    );
  }

  if (verifyGames > 0 && !file.verification) {
    const best: Partial<Record<Piece, number>> = {};
    for (const p of pieces) best[p] = file.estimates[p].best;
    const changed = Object.entries(best).some(([k, v]) => v !== ref.eval.pieceValues[k as Piece]);
    if (changed) {
      console.log(`\n== Vérification : ${Object.entries(best).map(([k, v]) => `${FR[k as Piece]} ${v}`).join(', ')} contre la référence ==`);
      const r = await match(variant(best, 'Valeurs de l’arène'), 'combinaison', verifyGames);
      const { elo, se } = eloWithSe(r.w, r.d, r.l);
      file.verification = { config: best as Record<string, number>, games: r.w + r.d + r.l, wins: r.w, draws: r.d, losses: r.l, elo, se };
      save();
      console.log(`  → Elo ${elo >= 0 ? '+' : ''}${elo.toFixed(0)} ± ${(1.96 * se).toFixed(0)} (IC95)`);
    }
  }
  writeReport();
  console.log(`\nRésultats : ${out}`);
  process.exit(0);
}

function writeReport() {
  const lines: string[] = [];
  const c = file.conditions;
  lines.push(`# Arène des valeurs de pièces — ${file.createdAt.slice(0, 10)}`, '');
  lines.push(
    `Truk contre Truk, ${c.nodes} nœuds par coup, ${c.games} parties par point (couleurs inversées, ouvertures ${c.openings}), adjudication ${c.adjudication}.`,
    `Règle conservée : pion = 100 ; avancement des pions ${file.base.eval.pawnAdvancement.join(', ')} ; aucune variante ne touche aux pions.`,
    '',
  );
  for (const p of Object.keys(file.points) as Piece[]) {
    const e = file.estimates[p];
    lines.push(`## ${FR[p]} (référence ${e?.reference ?? file.base.eval.pieceValues[p]})`, '', '| Valeur | V | N | D | Elo vs référence |', '|---|---|---|---|---|');
    const refVal = file.base.eval.pieceValues[p];
    for (const pt of [...file.points[p]].sort((a, b) => a.offset - b.offset)) {
      lines.push(`| ${refVal + pt.offset} | ${pt.wins} | ${pt.draws} | ${pt.losses} | ${pt.elo >= 0 ? '+' : ''}${pt.elo.toFixed(0)} ± ${(1.96 * pt.se).toFixed(0)} |`);
    }
    if (e) {
      lines.push(
        '',
        e.optimum === null
          ? `Courbe non concave : l'optimum est hors de la plage testée (retenu : ${e.best}).`
          : `Optimum estimé : **${Math.round(refVal + e.optimum)}** (IC95 bootstrap ${Math.round(refVal + e.low!)} – ${Math.round(refVal + e.high!)} ; parabole concave dans ${(e.concaveShare * 100).toFixed(0)} % des tirages ; gain estimé au sommet ${e.gainAtOptimum!.toFixed(0)} Elo). Valeur retenue : ${e.best}.`,
        '',
      );
    }
  }
  const v = file.verification;
  if (v) {
    lines.push(
      '## Vérification de la combinaison',
      '',
      `${Object.entries(v.config).map(([k, x]) => `${FR[k as Piece]} ${x}`).join(', ')} contre la référence : +${v.wins} =${v.draws} -${v.losses} sur ${v.games} parties → **${v.elo >= 0 ? '+' : ''}${v.elo.toFixed(0)} ± ${(1.96 * v.se).toFixed(0)} Elo** (IC95).`,
      '',
    );
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync(`reports/arena-${file.id}.md`, lines.join('\n'));
  console.log(`Rapport : reports/arena-${file.id}.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
