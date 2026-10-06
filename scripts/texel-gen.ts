// Génération de données pour le réglage Texel : parties Truk contre Truk (aucun Stockfish),
// puis extraction de positions calmes étiquetées par le résultat final de la partie.
// Usage : npm run texel-gen -- --games 3000 --nodes 3000 -j 4 [--config configs/x.json] [--offset 5000]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Game } from '../src/core/game';
import { uciToMove } from '../src/core/notation';
import { FLAG_CAPTURE, moveFlags, movePromo } from '../src/core/types';
import { defaultEngineConfig, normalizeConfig } from '../src/engine/params';
import { runParallelTournament } from '../src/match/parallel';
import { defaultAdjudication } from '../src/match/types';

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const games = Number(arg('games', '1000'));
const nodes = Number(arg('nodes', '3000'));
const j = Number(argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : 4);
const offset = Number(arg('offset', '5000'));
const cfg = arg('config') ? normalizeConfig(JSON.parse(readFileSync(arg('config')!, 'utf8'))) : defaultEngineConfig('Truk');

async function main() {
  const t0 = Date.now();
  const rec = await runParallelTournament(
    {
      name: 'texel self-play',
      a: { kind: 'truk', label: 'A', config: cfg, limits: { nodes } },
      b: { kind: 'truk', label: 'B', config: cfg, limits: { nodes } },
      games,
      openings: 'random',
      openingOffset: offset,
      openingSeed: 1,
      maxPlies: 400,
      adjudication: { ...defaultAdjudication(), enabled: true, resignCp: 1500, resignMoves: 5, drawCp: 5, drawMoves: 20, drawMinPly: 120 },
    },
    j,
    (_g, r) => {
      if (r.games.length % 100 === 0) console.log(`${r.games.length} parties (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    },
  );
  const lines: string[] = [];
  let kept = 0;
  for (const g of rec.games) {
    if (g.reason === 'error' || g.reason === 'max-moves' || g.result === '*') continue;
    const r = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    const game = new Game(g.startFen);
    g.moves.forEach((m, i) => {
      // Position avant le coup i : calme si hors livre, hors échec, et coup joué non tactique.
      if (!m.book && i >= 8 && !game.pos.inCheck() && Math.abs(m.scoreCp ?? 9999) < 1500) {
        const mv = uciToMove(game.pos, m.uci);
        if (mv !== null && !(moveFlags(mv) & FLAG_CAPTURE) && !movePromo(mv)) {
          lines.push(`${game.fen};${r}`);
          kept++;
        }
      }
      game.playUci(m.uci);
    });
  }
  mkdirSync('results/texel', { recursive: true });
  const file = `results/texel/data-${rec.id}.txt`;
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`${rec.games.length} parties, ${kept} positions → ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
