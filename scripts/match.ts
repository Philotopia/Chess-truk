// Tournoi en ligne de commande (sans interface) : Truk vs Stockfish ou Truk vs Truk, en parallèle, avec SPRT optionnel.
// Exemples :
//   npm run match -- --games 20 --nodes 5000                         Truk 5000 nœuds vs SF 5000 nœuds
//   npm run match -- --games 30 --truk-time 200 --sf-time 200 -j 4   4 parties en parallèle
//   npm run match -- --ladder 300,1000,3000 --games 10                échelle en nœuds
//   npm run match -- --b-truk --b-set search.lmr=false --truk-time 50 --openings random --sprt 0,10 --games 4000 -j 4
//   npm run match -- --b-config configB.json --nodes 3000             A/B entre deux configs Truk
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EngineConfig, cloneConfig, defaultEngineConfig, normalizeConfig, setByPath, v1SearchOptions } from '../src/engine/params';
import { createNodePlayer } from '../src/match/factoryNode';
import { runParallelTournament } from '../src/match/parallel';
import { sprt } from '../src/match/sprt';
import { type TournamentConfig, type TournamentRecord, runTournament, tournamentPgn } from '../src/match/tournament';
import { defaultAdjudication, type PlayerSpec } from '../src/match/types';
import { defaultStockfishSettings, describeLimits } from '../src/stockfish/presets';

const argv = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const has = (name: string) => argv.includes(`--${name}`);
const num = (name: string, def?: number) => (arg(name) !== undefined ? Number(arg(name)) : def);

const games = num('games', 10)!;
const nodes = num('nodes');
const concurrency = Number(arg('j') ?? (argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : 1));
const ladder = arg('ladder')?.split(',').map(Number);
const sprtArg = arg('sprt')?.split(',').map(Number);

/** Surcharges « chemin=valeur;chemin=valeur » (ex. search.lmr=false;eval.pieceValues.knight=310). */
function applySets(c: EngineConfig, spec: string | undefined): EngineConfig {
  if (!spec) return c;
  const out = cloneConfig(c);
  for (const part of spec.split(';').filter(Boolean)) {
    const [path, raw] = part.split('=');
    const v = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw;
    setByPath(out, path.startsWith('eval.') || path.startsWith('search.') || path === 'name' ? path : `eval.${path}`, v);
  }
  return out;
}

const loadCfg = (file: string | undefined, name: string) => (file ? normalizeConfig(JSON.parse(readFileSync(file, 'utf8'))) : defaultEngineConfig(name));
/** --a-search v1 / --b-search v1 : options de recherche de la V1. */
function withSearchPreset(c: EngineConfig, preset: string | undefined, label: string): EngineConfig {
  if (preset !== 'v1') return c;
  return { ...c, name: `${c.name} [${label} recherche V1]`.replace(` [${label} `, ' ['), search: { ...v1SearchOptions(), ttSizeMB: c.search.ttSizeMB } };
}
const configA = applySets(withSearchPreset(loadCfg(arg('a-config'), 'Truk A'), arg('a-search'), 'A'), arg('a-set'));
const bIsTruk = has('b-truk') || !!arg('b-config') || !!arg('b-set') || !!arg('b-search');
const configB = bIsTruk ? applySets(withSearchPreset(loadCfg(arg('b-config'), 'Truk B'), arg('b-search'), 'B'), arg('b-set')) : null;

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

async function runOne(n?: number): Promise<TournamentRecord> {
  const la = clean({ nodes: num('truk-nodes', n), timeMs: num('truk-time'), depth: num('truk-depth') });
  const a: PlayerSpec = { kind: 'truk', label: `${configA.name} (${describeLimits(la)})`, config: configA, limits: la };
  let b: PlayerSpec;
  if (configB) {
    b = { kind: 'truk', label: `${configB.name} (${describeLimits(la)})`, config: configB, limits: la };
  } else {
    const sl = clean({ nodes: num('sf-nodes', n), movetime: num('sf-time'), depth: num('sf-depth') });
    const settings = { ...defaultStockfishSettings() };
    if (arg('sf-skill') !== undefined) settings.skillLevel = num('sf-skill')!;
    if (arg('sf-elo') !== undefined) {
      settings.limitStrength = true;
      settings.elo = num('sf-elo')!;
    }
    b = { kind: 'stockfish', label: `Stockfish (${describeLimits(sl)})`, settings, limits: sl, refElo: settings.limitStrength ? settings.elo : undefined };
  }
  const config: TournamentConfig = {
    name: `${a.label} vs ${b.label}`,
    a,
    b,
    games,
    openings: (arg('openings') as TournamentConfig['openings']) ?? 'book',
    openingOffset: num('opening-offset', 0)!,
    openingSeed: num('seed', 1),
    maxPlies: num('max-plies', 300)!,
    adjudication: { ...defaultAdjudication(), enabled: has('adjudicate') },
  };
  const quiet = has('quiet');
  console.log(`\n=== ${config.name} — ${games} parties max, ${concurrency} en parallèle${sprtArg ? `, SPRT [${sprtArg[0]}, ${sprtArg[1]}]` : ''} ===`);
  const onGameEnd = (g: TournamentRecord['games'][number], r: TournamentRecord): boolean => {
    const s = r.stats;
    let line = `#${g.index + 1} ${g.result} (${g.reason}, ${g.moves.length} ½c) | A +${s.wins} =${s.draws} -${s.losses} ${(s.score * 100).toFixed(1)}%`;
    let stopNow = false;
    if (sprtArg) {
      const t = sprt(s.wins, s.draws, s.losses, sprtArg[0], sprtArg[1]);
      line += ` | LLR ${t.llr.toFixed(2)} [${t.lower.toFixed(2)}, ${t.upper.toFixed(2)}]`;
      stopNow = t.status !== 'continue';
    }
    if (!quiet || stopNow || r.games.length % 50 === 0) console.log(line);
    return stopNow;
  };
  const rec =
    concurrency > 1
      ? await runParallelTournament(config, concurrency, onGameEnd)
      : await runTournament(config, createNodePlayer, { onGameEnd, shouldAbort: () => false }, n !== undefined ? { ladderValue: n } : {});
  if (n !== undefined) rec.ladderValue = n;
  const s = rec.stats;
  const fmt = (x: number | null) => (x === null ? 'n/d' : (x >= 0 ? '+' : '') + x.toFixed(0));
  console.log(`Résultat A : +${s.wins} =${s.draws} -${s.losses}  score ${(s.score * 100).toFixed(1)} %  (${s.games} parties)`);
  console.log(`Elo A−B : ${fmt(s.elo)} [IC95 ${fmt(s.eloLow)} ; ${fmt(s.eloHigh)}]  LOS ${s.los === null ? 'n/d' : (s.los * 100).toFixed(1) + ' %'}`);
  if (sprtArg) {
    const t = sprt(s.wins, s.draws, s.losses, sprtArg[0], sprtArg[1]);
    console.log(`SPRT [${sprtArg[0]}, ${sprtArg[1]}] : LLR ${t.llr.toFixed(2)} → ${t.status === 'H1' ? 'H1 accepté (gain)' : t.status === 'H0' ? 'H0 accepté (pas de gain)' : 'non conclusif'}`);
  }
  console.log(`Nœuds moyens/coup : A ${s.a.avgNodes.toFixed(0)}  B ${s.b.avgNodes.toFixed(0)} ; profondeur moy. A ${s.a.avgDepth.toFixed(1)}  B ${s.b.avgDepth.toFixed(1)}`);
  console.log(`Demi-coups moyens ${s.avgPlies.toFixed(1)} ; durée moyenne ${(s.avgDurationMs / 1000).toFixed(1)} s`);
  mkdirSync('results', { recursive: true });
  const base = `results/${rec.id}`;
  writeFileSync(`${base}.json`, JSON.stringify(rec, null, 2));
  writeFileSync(`${base}.pgn`, tournamentPgn(rec));
  console.log(`Enregistré : ${base}.json / ${base}.pgn`);
  return rec;
}

async function main() {
  if (ladder) {
    const rows: string[] = [];
    for (const n of ladder) {
      const r = await runOne(n);
      rows.push(`${String(n).padStart(8)} : ${(r.stats.score * 100).toFixed(1).padStart(5)} %  (+${r.stats.wins} =${r.stats.draws} -${r.stats.losses})`);
    }
    console.log('\n=== Échelle (score de Truk) ===\n' + rows.join('\n'));
  } else {
    await runOne(nodes);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
