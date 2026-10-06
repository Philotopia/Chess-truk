import { Position } from './position';

const PERFT_STRIDE = 320;
const buffers: Int32Array[] = [];

/** Compte les feuilles légales à profondeur donnée (validation du générateur de coups). */
export function perft(pos: Position, depth: number, ply = 0): number {
  if (depth === 0) return 1;
  let buf = buffers[ply];
  if (!buf) buf = buffers[ply] = new Int32Array(PERFT_STRIDE);
  const n = pos.generateMoves(buf, 0);
  let nodes = 0;
  for (let i = 0; i < n; i++) {
    if (!pos.makeMove(buf[i])) continue;
    nodes += depth === 1 ? 1 : perft(pos, depth - 1, ply + 1);
    pos.unmakeMove();
  }
  return nodes;
}

/** Perft détaillé par coup racine (« divide »), utile au débogage. */
export function perftDivide(pos: Position, depth: number): Map<number, number> {
  const res = new Map<number, number>();
  for (const m of pos.legalMoves()) {
    pos.makeMove(m);
    res.set(m, perft(pos, depth - 1, 1));
    pos.unmakeMove();
  }
  return res;
}

/** Positions de référence (chessprogramming.org/Perft_Results). */
export const PERFT_SUITE: { name: string; fen: string; counts: number[] }[] = [
  {
    name: 'Position initiale',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    counts: [20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603],
  },
  {
    name: 'Position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'Position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333],
  },
  {
    name: 'Position 4 (miroir)',
    fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1',
    counts: [6, 264, 9467, 422333],
  },
  {
    name: 'Position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487],
  },
  {
    name: 'Position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890, 3894594],
  },
];
