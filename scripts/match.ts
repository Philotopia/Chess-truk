// Tournoi en ligne de commande (sans interface) : Truk vs Stockfish ou Truk vs Truk.
// Exemples :
//   npm run match -- --games 20 --nodes 5000                 (Truk 5000 nœuds vs SF 5000 nœuds)
//   npm run match -- --games 10 --truk-time 200 --sf-depth 3
//   npm run match -- --ladder 300,1000,3000 --games 10        (échelle en nœuds)
//   npm run match -- --games 20 --nodes 3000 --b-config configB.json   (A/B entre deux configs Truk)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultEngineConfig, normalizeConfig } from '../src/engine/params';
import { createNodePlayer } from '../src/match/factoryNode';
import { type TournamentConfig, runTournament, tournamentPgn } from '../src/match/tournament';
import { defaultAdjudication, type PlayerSpec } from '../src/match/types';
import { defaultStockfishSettings, describeLimits } from '../src/stockfish/presets';

const argv = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const num = (name: string, def?: number) => (arg(name) !== undefined ? Number(arg(name)) : def);

const games = num('games', 10)!;
const nodes = num('nodes');
const ladder = arg('ladder')?.split(',').map(Number);
const configA = arg('a-config') ? normalizeConfig(JSON.parse(readFileSync(arg('a-config')!, 'utf8'))) : defaultEngineConfig('Truk A');
const configB = arg('b-config') ? normalizeConfig(JSON.parse(readFileSync(arg('b-config')!, 'utf8'))) : null;

function trukLimits(n?: number) {
  return { nodes: num('truk-nodes', n), timeMs: num('truk-time'), depth: num('truk-depth') };
}
function sfLimits(n?: number) {
  return { nodes: num('sf-nodes', n), movetime: num('sf-time'), depth: num('sf-depth') };
}
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

async function runOne(n?: number) {
  const la = clean(trukLimits(n));
  const a: PlayerSpec = { kind: 'truk', label: `${configA.name} (${describeLimits(la)})`, config: configA, limits: la };
  let b: PlayerSpec;
  if (configB) {
    b = { kind: 'truk', label: `${configB.name} (${describeLimits(la)})`, config: configB, limits: la };
  } else {
    const sl = clean(sfLimits(n));
    const settings = { ...defaultStockfishSettings() };
    if (arg('sf-skill') !== undefined) settings.skillLevel = num('sf-skill')!;
    if (arg('sf-elo') !== undefined) {
      settings.limitStrength = true;
      settings.elo = num('sf-elo')!;
    }
    b = { kind: 'stockfish', label: `Stockfish (${describeLimits(sl)})`, settings, limits: sl };
  }
  const config: TournamentConfig = {
    name: `${a.label} vs ${b.label}`,
    a,
    b,
    games,
    openings: arg('openings') === 'startpos' ? 'startpos' : 'book',
    openingOffset: num('opening-offset', 0)!,
    maxPlies: num('max-plies', 300)!,
    adjudication: { ...defaultAdjudication(), enabled: argv.includes('--adjudicate') },
  };
  console.log(`\n=== ${config.name} — ${games} parties ===`);
  const rec = await runTournament(config, createNodePlayer, {
    onGameEnd: (g, r) => {
      const s = r.stats;
      console.log(
        `#${g.index + 1} ${g.white} – ${g.black} : ${g.result} (${g.reason}, ${g.moves.length} demi-coups, ${g.openingName}) ` +
          `| A ${s.wins}V ${s.draws}N ${s.losses}D ${(s.score * 100).toFixed(1)}%`,
      );
    },
  }, n !== undefined ? { ladderValue: n } : {});
  const s = rec.stats;
  const fmt = (x: number | null) => (x === null ? 'n/d' : (x >= 0 ? '+' : '') + x.toFixed(0));
  console.log(`Résultat A : +${s.wins} =${s.draws} -${s.losses}  score ${(s.score * 100).toFixed(1)} %`);
  console.log(`Elo A−B : ${fmt(s.elo)} [IC95 ${fmt(s.eloLow)} ; ${fmt(s.eloHigh)}]  LOS ${s.los === null ? 'n/d' : (s.los * 100).toFixed(1) + ' %'}`);
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
      rows.push(`${String(n).padStart(8)} nœuds : ${(r.stats.score * 100).toFixed(1).padStart(5)} %  (+${r.stats.wins} =${r.stats.draws} -${r.stats.losses})`);
    }
    console.log('\n=== Échelle en nœuds (score de Truk) ===\n' + rows.join('\n'));
  } else {
    await runOne(nodes);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
