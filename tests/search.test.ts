import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/core/fen';
import { Game } from '../src/core/game';
import type { Position } from '../src/core/position';
import { START_FEN } from '../src/core/types';
import { TrukEngine } from '../src/engine/engine';
import { evaluateStm } from '../src/engine/evaluate';
import { type SearchOptions, defaultEngineConfig, defaultEvalParams, defaultSearchOptions, v1SearchOptions } from '../src/engine/params';
import { MATE, Searcher, mateIn } from '../src/engine/search';
import { TT_EXACT, TT_LOWER, TranspositionTable } from '../src/engine/tt';

const params = defaultEvalParams();

function searcher(opts: Partial<SearchOptions> = {}) {
  return new Searcher(params, { ...defaultSearchOptions(), ...opts });
}

/** Toutes les options booléennes désactivées sauf le tri MVV-LVA (alpha-bêta pur, ordre raisonnable). */
const ALL_OFF: Partial<SearchOptions> = {
  ...(Object.fromEntries(
    Object.entries(defaultSearchOptions())
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => [k, false]),
  ) as Partial<SearchOptions>),
  mvvLva: true,
};

/** Minimax brut sans élagage, mêmes règles de feuille que la recherche sans quiescence. */
function minimax(pos: Position, depth: number, ply: number): number {
  if (ply > 0 && (pos.halfmove >= 100 || pos.isInsufficientMaterial() || pos.repetitionCount() > 0)) return 0;
  const moves = pos.legalMoves();
  if (moves.length === 0) return pos.inCheck() ? -MATE + ply : 0;
  if (depth === 0) return evaluateStm(pos, params);
  let best = -Infinity;
  for (const m of moves) {
    pos.makeMove(m);
    const s = -minimax(pos, depth - 1, ply + 1);
    pos.unmakeMove();
    if (s > best) best = s;
  }
  return best;
}

const MINIMAX_FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
];

describe('recherche : exactitude', () => {
  it('alpha-bêta (+ tri, killers, historique, PVS, aspiration) = minimax exact à profondeur fixe', () => {
    for (const fen of MINIMAX_FENS) {
      const depth = fen.startsWith('r3k2r') ? 2 : 3;
      const expected = minimax(parseFen(fen), depth, 0);
      for (const extra of [
        {},
        { killers: true, history: true },
        { pvs: true },
        { aspiration: true, pvs: true, killers: true, history: true },
      ]) {
        const r = searcher({ ...ALL_OFF, ...extra }).search(parseFen(fen), { depth });
        expect(r.score, `${fen} ${JSON.stringify(extra)}`).toBe(expected);
        expect(r.completedDepth).toBe(depth);
      }
    }
  });

  const MATES: { fen: string; best: string; mate: number }[] = [
    { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', best: 'd1d8', mate: 1 },
    { fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1', best: 'e2e8', mate: 2 },
    { fen: 'r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1', best: 'd5f6', mate: 2 },
  ];

  const VARIANTS: Partial<SearchOptions>[] = [
    {},
    v1SearchOptions(),
    ALL_OFF,
    { ...ALL_OFF, quiescence: true },
    { nullMove: false },
    { lmr: false },
    { useTT: false },
    { pvs: false, aspiration: false },
    { checkExtension: false },
  ];

  for (const { fen, best, mate } of MATES) {
    it(`trouve le mat en ${mate} (${best}) avec toutes les variantes d'options`, () => {
      for (const v of VARIANTS) {
        const r = searcher(v).search(parseFen(fen), { depth: 2 * mate + 1 });
        expect(r.bestMove, JSON.stringify(v)).toBe(best);
        expect(r.mate).toBe(mate);
      }
    });
  }

  it('camp maté : score de mat négatif, et position de mat sans coup', () => {
    const r = searcher().search(parseFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1'), { depth: 4 });
    expect(r.mate === null || r.mate < 0 || r.score < 0).toBe(true);
    const mated = searcher().search(parseFen('3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1'), { depth: 3 });
    expect(mated.bestMove).toBeNull();
    expect(mated.score).toBe(-MATE);
    const pat = searcher().search(parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), { depth: 3 });
    expect(pat.bestMove).toBeNull();
    expect(pat.score).toBe(0);
  });

  it('évite le pat quand il gagne', () => {
    const r = searcher().search(parseFen('k7/8/8/2Q5/8/8/8/K7 w - - 0 1'), { depth: 5 });
    expect(r.bestMove).not.toBe('c5b6');
    expect(r.score).toBeGreaterThan(500);
  });

  it('gagne la dame en prise', () => {
    const r = searcher().search(parseFen('rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1'), {
      depth: 4,
    });
    expect(r.bestMove).toBe('c1g5');
  });

  it('nulle par répétition : le camp perdant choisit le coup qui répète la position', () => {
    const g = new Game('7k/8/8/8/8/8/8/1Q2K3 b - - 0 1');
    for (const u of ['h8g8', 'b1c1', 'g8h8', 'c1b1']) g.playUci(u);
    // h8g8 recrée une position déjà vue (répétition = 0) ; h8g7 laisse les blancs avec une dame de plus.
    for (const v of VARIANTS) {
      const r = searcher(v).search(g.pos, { depth: 4 });
      expect(r.bestMove, JSON.stringify(v)).toBe('h8g8');
      expect(r.score).toBe(0);
    }
  });
});

describe('conversion des finales gagnées', () => {
  for (const fen of ['8/8/8/8/2k5/3q4/5K2/8 b - - 0 1', '8/8/8/3k4/8/8/8/R3K3 w - - 0 1']) {
    it(`mate seul : ${fen}`, () => {
      const eng = new TrukEngine(defaultEngineConfig());
      const g = new Game(fen);
      while (!g.status().over && g.moves.length < 100) g.playUci(eng.searchGame(g.startFen, g.uciMoves(), { nodes: 20000 }).bestMove!);
      expect(g.status().reason).toBe('checkmate');
    });
  }
});

describe('recherche : limites et reproductibilité', () => {
  it('limite de nœuds respectée et résultat déterministe', () => {
    const a = searcher().search(parseFen(START_FEN), { nodes: 20000 });
    const b = searcher().search(parseFen(START_FEN), { nodes: 20000 });
    expect(a.nodes).toBeLessThanOrEqual(20001);
    expect(a.bestMove).toBe(b.bestMove);
    expect(a.nodes).toBe(b.nodes);
    expect(a.score).toBe(b.score);
    expect(a.completedDepth).toBeGreaterThanOrEqual(3);
  });

  it('limite de temps respectée (avec marge)', () => {
    const t0 = performance.now();
    const r = searcher().search(parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), {
      timeMs: 300,
    });
    const el = performance.now() - t0;
    expect(el).toBeLessThan(600);
    expect(r.bestMove).not.toBeNull();
  });

  it('profondeur 1 toujours terminée même avec un budget minuscule', () => {
    const r = searcher().search(parseFen(START_FEN), { nodes: 1 });
    expect(r.bestMove).not.toBeNull();
    expect(r.completedDepth).toBeGreaterThanOrEqual(1);
  });

  it('la position est restaurée après la recherche', () => {
    const pos = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const h = [pos.hashLo, pos.hashHi, pos.ply];
    searcher().search(pos, { depth: 4 });
    expect([pos.hashLo, pos.hashHi, pos.ply]).toEqual(h);
  });

  it('PV légale et cohérente avec le meilleur coup', () => {
    const eng = new TrukEngine(defaultEngineConfig());
    const r = eng.searchGame(START_FEN, ['e2e4', 'e7e5'], { depth: 5 });
    expect(r.pv[0]).toBe(r.bestMove);
    const g = Game.fromUci(START_FEN, ['e2e4', 'e7e5']);
    for (const u of r.pv) g.playUci(u); // lève une exception si illégal
  });

  it('mateIn', () => {
    expect(mateIn(MATE - 1)).toBe(1);
    expect(mateIn(MATE - 3)).toBe(2);
    expect(mateIn(-MATE + 2)).toBe(-1);
    expect(mateIn(150)).toBeNull();
  });
});

describe('table de transposition', () => {
  it('stockage / sonde / remplacement', () => {
    const tt = new TranspositionTable(1);
    expect(tt.probe(123, 456)).toBe(false);
    tt.store(123, 456, 5, TT_EXACT, 42, 777);
    expect(tt.probe(123, 456)).toBe(true);
    expect([tt.hitDepth, tt.hitFlag, tt.hitScore, tt.hitMove]).toEqual([5, TT_EXACT, 42, 777]);
    // Collision d'index avec une autre clé hi : pas de faux positif.
    expect(tt.probe(123, 999)).toBe(false);
    // Entrée moins profonde de la même recherche, autre position au même index : non remplacée.
    tt.store(123, 999, 2, TT_LOWER, 10, 1);
    expect(tt.probe(123, 456)).toBe(true);
    // Nouvelle recherche : remplaçable.
    tt.newSearch();
    tt.store(123, 999, 2, TT_LOWER, 10, 1);
    expect(tt.probe(123, 999)).toBe(true);
    expect(tt.hashfull()).toBeGreaterThanOrEqual(0);
  });

  it('la TT réduit le nombre de nœuds à profondeur égale', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    const withTT = searcher({ ...ALL_OFF, quiescence: true, useTT: true }).search(parseFen(fen), { depth: 4 });
    const noTT = searcher({ ...ALL_OFF, quiescence: true }).search(parseFen(fen), { depth: 4 });
    expect(withTT.nodes).toBeLessThan(noTT.nodes);
    expect(withTT.ttHits).toBeGreaterThan(0);
  });
});
