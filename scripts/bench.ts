// Banc de vitesse : perft (générateur), évaluation et recherche sur un jeu de positions fixes.
// Usage : npm run bench [-- --depth 7]
import { parseFen } from '../src/core/fen';
import { perft } from '../src/core/perft';
import { evaluate } from '../src/engine/evaluate';
import { defaultEvalParams, defaultSearchOptions } from '../src/engine/params';
import { Searcher } from '../src/engine/search';

const args = process.argv.slice(2);
const depthArg = args.indexOf('--depth');
const depth = depthArg >= 0 ? Number(args[depthArg + 1]) : 6;

const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w KQ - 0 8',
  '2r2rk1/pp3ppp/2n1b3/3p4/3P4/2NB1N2/PP3PPP/2R2RK1 w - - 0 18',
];

let t = performance.now();
const pn = perft(parseFen(FENS[1]), 4);
let el = performance.now() - t;
console.log(`perft Kiwipete d4 : ${pn} nœuds en ${el.toFixed(0)} ms (${Math.round((pn / el) * 1000).toLocaleString()} n/s)`);

const params = defaultEvalParams();
const positions = FENS.map((f) => parseFen(f));
const N = 200_000;
t = performance.now();
let sink = 0;
for (let i = 0; i < N; i++) sink += evaluate(positions[i % positions.length], params);
el = performance.now() - t;
console.log(`évaluation : ${((el * 1000) / N).toFixed(2)} µs/position (${Math.round((N / el) * 1000).toLocaleString()} évals/s) [${sink % 7}]`);

let totalNodes = 0;
let totalTime = 0;
for (const fen of FENS) {
  const s = new Searcher(params, defaultSearchOptions());
  const r = s.search(parseFen(fen), { depth });
  totalNodes += r.nodes;
  totalTime += r.timeMs;
  console.log(
    `d${r.completedDepth} ${r.bestMove?.padEnd(5)} score ${String(r.score).padStart(5)} nœuds ${r.nodes.toLocaleString().padStart(10)} ` +
      `${r.timeMs.toFixed(0).padStart(6)} ms  ${r.nps.toLocaleString()} nps  TT ${r.hashfull}‰`,
  );
}
console.log(`TOTAL : ${totalNodes.toLocaleString()} nœuds, ${totalTime.toFixed(0)} ms, ${Math.round((totalNodes / totalTime) * 1000).toLocaleString()} nps`);
