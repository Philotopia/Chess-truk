/// <reference lib="webworker" />
// Diagnostics exécutés dans le navigateur : perft (exactitude du générateur) et banc de vitesse.
import { parseFen } from '../core/fen';
import { PERFT_SUITE, perft } from '../core/perft';
import { defaultEvalParams, defaultSearchOptions } from '../engine/params';
import { Searcher } from '../engine/search';

const BENCH = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];

self.onmessage = (e: MessageEvent<{ type: 'perft' | 'bench'; maxNodes?: number; depth?: number }>) => {
  if (e.data.type === 'perft') {
    const maxNodes = e.data.maxNodes ?? 5_000_000;
    for (const { name, fen, counts } of PERFT_SUITE) {
      counts.forEach((expected, i) => {
        if (expected > maxNodes) return;
        const pos = parseFen(fen);
        const t0 = performance.now();
        const got = perft(pos, i + 1);
        const ms = performance.now() - t0;
        self.postMessage({ type: 'perft', name, depth: i + 1, expected, got, ms });
      });
    }
    self.postMessage({ type: 'done' });
  } else {
    let nodes = 0;
    let time = 0;
    for (const fen of BENCH) {
      const s = new Searcher(defaultEvalParams(), defaultSearchOptions());
      const r = s.search(parseFen(fen), { depth: e.data.depth ?? 6 });
      nodes += r.nodes;
      time += r.timeMs;
      self.postMessage({ type: 'bench', fen, depth: r.completedDepth, nodes: r.nodes, ms: r.timeMs, nps: r.nps, best: r.bestMove });
    }
    self.postMessage({ type: 'done', nodes, time });
  }
};
