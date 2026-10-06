import { parseFen } from '../src/core/fen';
import { defaultEvalParams, defaultSearchOptions } from '../src/engine/params';
import { Searcher } from '../src/engine/search';
const FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w KQ - 0 8',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];
let n = 0, t = 0;
for (const f of FENS) { const r = new Searcher(defaultEvalParams(), defaultSearchOptions()).search(parseFen(f), { timeMs: 3000 }); n += r.nodes; t += r.timeMs; console.log(r.completedDepth, r.nodes, r.nps); }
console.log('nps', Math.round(n / t * 1000));
