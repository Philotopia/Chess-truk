import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { defaultEngineConfig } from '../src/engine/params';
import { analyzeMoves, classifyLoss, comparePosition, summarize, toWhitePov } from '../src/match/compare';
import { importPositions } from '../src/match/dataset';
import { OPENING_BOOK, openingToUci } from '../src/match/openings';
import { createNodePlayer } from '../src/match/factoryNode';
import { playGame } from '../src/match/runner';
import { computeStats, eloFromScore } from '../src/match/stats';
import { runTournament } from '../src/match/tournament';
import { defaultAdjudication, type GameRecord } from '../src/match/types';
import { parseInfoLine, parseOptionLine } from '../src/stockfish/uci';

describe('livre d’ouvertures', () => {
  it('toutes les lignes sont légales et distinctes', () => {
    const seen = new Set<string>();
    for (const o of OPENING_BOOK) {
      const u = openingToUci(o);
      expect(u.length).toBe(o.moves.length);
      const fen = Game.fromUci(new Game().startFen, u).fen;
      expect(seen.has(fen), o.name).toBe(false);
      seen.add(fen);
    }
    expect(OPENING_BOOK.length).toBeGreaterThanOrEqual(40);
  });
});

describe('statistiques', () => {
  const mk = (result: GameRecord['result'], aIsWhite: boolean): GameRecord => ({
    index: 0, aIsWhite, white: 'w', black: 'b', openingName: '', startFen: new Game().startFen,
    moves: [], result, reason: 'checkmate', durationMs: 1000, pgn: '',
  });
  it('score, Elo et IC', () => {
    const games = [mk('1-0', true), mk('1-0', false), mk('1/2-1/2', true), mk('0-1', false)];
    // A : gagne (blancs), perd (noirs), nulle, gagne (noirs) → 2.5 / 4
    const s = computeStats(games);
    expect([s.wins, s.draws, s.losses]).toEqual([2, 1, 1]);
    expect(s.score).toBeCloseTo(0.625);
    expect(s.elo).toBeCloseTo(eloFromScore(0.625));
    expect(s.eloLow!).toBeLessThan(s.elo!);
    expect(s.eloHigh!).toBeGreaterThan(s.elo!);
    expect(eloFromScore(0.5)).toBeCloseTo(0);
    expect(eloFromScore(0.76)).toBeCloseTo(200, -1);
    expect(s.asWhite).toEqual({ w: 1, d: 1, l: 0 });
  });
});

describe('UCI', () => {
  it('analyse des lignes info / option', () => {
    const i = parseInfoLine('info depth 12 seldepth 18 multipv 1 score cp -35 nodes 12345 nps 500000 hashfull 12 time 24 pv e2e4 e7e5 g1f3');
    expect(i).toMatchObject({ depth: 12, seldepth: 18, scoreCp: -35, mate: null, nodes: 12345, pv: ['e2e4', 'e7e5', 'g1f3'] });
    const m = parseInfoLine('info depth 5 score mate -2 lowerbound nodes 10 pv a1a2');
    expect(m).toMatchObject({ mate: -2, bound: 'lower' });
    expect(parseInfoLine('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseOptionLine('option name Skill Level type spin default 20 min 0 max 20')).toEqual({
      name: 'Skill Level', type: 'spin', default: '20', min: 0, max: 20,
    });
  });
});

describe('comparaison et perte en centipawns', () => {
  it('conversion point de vue blancs et classement', () => {
    expect(toWhitePov(50, null, false)).toBe(-50);
    expect(toWhitePov(null, 2, true)).toBe(9998);
    expect(classifyLoss(350)).toBe('blunder');
    expect(classifyLoss(120)).toBe('mistake');
    expect(classifyLoss(60)).toBe('inaccuracy');
  });
  it('CPL calculée avec les évaluations SF avant/après', () => {
    const v = (s: number, best: string | null) => ({ scoreWhite: s, mate: null, bestMove: best, depth: 1, nodes: 1, timeMs: 1, pv: [] });
    const pos = [
      comparePosition('a', v(20, 'e2e4'), v(30, 'e2e4')),
      comparePosition('b', v(-10, 'e7e5'), v(-300, 'e7e5')), // blanc a gaffé : 30 → −300
      comparePosition('c', v(0, null), v(-280, null)),
    ];
    const moves = analyzeMoves(pos, ['a2a3', 'e7e5'], true);
    expect(moves[0].cpl).toBe(330);
    expect(moves[0].cls).toBe('blunder');
    expect(moves[1].cpl).toBe(0);
    const s = summarize(pos, moves);
    expect(s.bestMoveAgreement).toBe(1);
    expect(s.white.blunders).toBe(1);
  });
});

describe('import de positions', () => {
  it('FEN, EPD avec bm, et PGN', () => {
    const r = importPositions(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n' +
        '2rr3k/pp3pp1/1nnqbN1p/3pN3/2pP4/2P3Q1/PPB4P/R4RK1 w - - bm Qg6; id "WAC.001";\n' +
        'n\'importe quoi\n',
    );
    expect(r.positions.length).toBe(2);
    expect(r.positions[1].bestMoves).toEqual(['g3g6']);
    expect(r.positions[1].id).toBe('WAC.001');
    expect(r.errors.length).toBe(1);
    const p = importPositions('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *\n', { pgnEvery: 2, pgnSkip: 2 });
    expect(p.positions.length).toBe(4);
  });
});

describe('intégration : parties et tournoi contre Stockfish WASM (Node)', () => {
  it('partie Truk vs Truk jusqu’au bout, PGN rejouable', async () => {
    const cfg = defaultEngineConfig('T');
    const a = await createNodePlayer({ kind: 'truk', label: 'A', config: cfg, limits: { nodes: 300 } });
    const b = await createNodePlayer({ kind: 'truk', label: 'B', config: cfg, limits: { nodes: 300 } });
    const g = await playGame(a, b, { maxPlies: 120 });
    expect(['1-0', '0-1', '1/2-1/2']).toContain(g.result);
    expect(g.pgn).toContain('[White "A"]');
  });

  it('calibration : Stockfish vs Stockfish (deux instances WASM dans le même processus)', async () => {
    const sf = (label: string) =>
      createNodePlayer({ kind: 'stockfish', label, settings: { flavor: 'lite-single', threads: 1, hashMB: 8, skillLevel: null, limitStrength: false, elo: 1320 }, limits: { nodes: 2000 } });
    const a = await sf('SF-A');
    const b = await sf('SF-B');
    const g = await playGame(a, b, { maxPlies: 60 });
    expect(g.reason).not.toBe('error');
    expect(g.moves.length).toBeGreaterThan(10);
    a.dispose();
    b.dispose();
    const c = await sf('SF-C'); // troisième instance après fermeture
    expect((await c.think(new Game().startFen, [])).uci).toMatch(/^[a-h][1-8][a-h][1-8]/);
    c.dispose();
  }, 120_000);

  it('mini-tournoi Truk vs Stockfish (2 parties, couleurs alternées)', async () => {
    const rec = await runTournament(
      {
        name: 'test',
        a: { kind: 'truk', label: 'Truk', config: defaultEngineConfig(), limits: { nodes: 500 } },
        b: { kind: 'stockfish', label: 'SF', settings: { flavor: 'lite-single', threads: 1, hashMB: 8, skillLevel: null, limitStrength: false, elo: 1320 }, limits: { depth: 1 } },
        games: 2,
        openings: 'book',
        openingOffset: 0,
        maxPlies: 160,
        adjudication: defaultAdjudication(),
      },
      createNodePlayer,
    );
    expect(rec.games.length).toBe(2);
    expect(rec.games[0].aIsWhite).toBe(true);
    expect(rec.games[1].aIsWhite).toBe(false);
    expect(rec.games[0].openingName).toBe(rec.games[1].openingName);
    expect(rec.stats.games).toBe(2);
    for (const g of rec.games) expect(g.reason).not.toBe('error');
  }, 120_000);
});
