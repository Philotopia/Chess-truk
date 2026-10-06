import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { FenError, parseFen, toFen } from '../src/core/fen';
import { Game, gameStatus } from '../src/core/game';
import { moveToSan, moveToUci, sanToMove } from '../src/core/notation';
import { exportPgn, parseMultiPgn, parsePgn } from '../src/core/pgn';
import { START_FEN } from '../src/core/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('règles : comparaison croisée avec chess.js sur parties aléatoires', () => {
  it('coups légaux, SAN, échec, mat, pat et matériel insuffisant identiques', () => {
    const rand = rng(42);
    let positions = 0;
    for (let g = 0; g < 30; g++) {
      const game = new Game();
      const ref = new Chess();
      for (let ply = 0; ply < 300; ply++) {
        const ours = game.pos.legalMoves().map((m) => moveToUci(m)).sort();
        const theirs = ref
          .moves({ verbose: true })
          .map((m) => m.from + m.to + (m.promotion ?? ''))
          .sort();
        expect(ours).toEqual(theirs);
        const sanOurs = game.pos.legalMoves().map((m) => moveToSan(game.pos, m)).sort();
        const sanTheirs = ref.moves().sort();
        expect(sanOurs).toEqual(sanTheirs);
        expect(game.pos.inCheck()).toBe(ref.inCheck());
        expect(toFen(game.pos).split(' ').slice(0, 3)).toEqual(ref.fen().split(' ').slice(0, 3));
        const st = gameStatus(game.pos);
        expect(st.reason === 'checkmate').toBe(ref.isCheckmate());
        expect(st.reason === 'stalemate').toBe(ref.isStalemate());
        if (!ref.isCheckmate() && !ref.isStalemate()) {
          expect(game.pos.isInsufficientMaterial()).toBe(ref.isInsufficientMaterial());
        }
        positions++;
        if (ours.length === 0 || game.pos.isInsufficientMaterial()) break;
        const pick = ours[Math.floor(rand() * ours.length)];
        game.playUci(pick);
        ref.move({ from: pick.slice(0, 2), to: pick.slice(2, 4), promotion: pick[4] });
      }
    }
    expect(positions).toBeGreaterThan(2500);
  });
});

describe('règles spéciales', () => {
  it('roques : autorisés, interdits à travers une case attaquée ou en échec', () => {
    const p = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const ucis = p.legalMoves().map(moveToUci);
    expect(ucis).toContain('e1g1');
    expect(ucis).toContain('e1c1');
    // Tour noire en f8 contrôle f1 : petit roque blanc interdit.
    const p2 = parseFen('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1');
    expect(p2.legalMoves().map(moveToUci)).not.toContain('e1g1');
    expect(p2.legalMoves().map(moveToUci)).toContain('e1c1');
    // Roi en échec : aucun roque.
    const p3 = parseFen('r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1');
    const u3 = p3.legalMoves().map(moveToUci);
    expect(u3).not.toContain('e1g1');
    expect(u3).not.toContain('e1c1');
    // b1 attaqué n'empêche pas le grand roque (seules e1, d1, c1 comptent).
    const p4 = parseFen('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(p4.legalMoves().map(moveToUci)).toContain('e1c1');
  });

  it('roque : la tour bouge et les droits disparaissent', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    g.playSan('O-O');
    expect(g.fen.split(' ')[0]).toBe('r3k2r/8/8/8/8/8/8/R4RK1');
    expect(g.fen.split(' ')[2]).toBe('kq');
    g.playSan('Rxa1');
    expect(g.fen.split(' ')[2]).toBe('k');
  });

  it('en passant : capture possible puis perdue au coup suivant', () => {
    const g = new Game('rnbqkbnr/ppp1pppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
    g.playSan('f5');
    expect(g.fen.split(' ')[3]).toBe('f6');
    const m = sanToMove(g.pos, 'exf6');
    expect(m).not.toBeNull();
    g.playSan('exf6');
    expect(g.fen.split(' ')[0]).toBe('rnbqkbnr/ppp1p1pp/5P2/8/8/8/PPPP1PPP/RNBQKBNR');
    g.undo();
    expect(g.fen.split(' ')[0]).toBe('rnbqkbnr/ppp1p1pp/8/4Pp2/8/8/PPPP1PPP/RNBQKBNR');
  });

  it('en passant interdit s’il expose le roi (clouage horizontal)', () => {
    const p = parseFen('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
    expect(p.legalMoves().map(moveToUci)).not.toContain('e5d6');
  });

  it('promotions : 4 pièces, avec et sans capture', () => {
    const p = parseFen('1n5k/P7/8/8/8/8/8/7K w - - 0 1');
    const ucis = p.legalMoves().map(moveToUci);
    for (const x of ['a8q', 'a8r', 'a8b', 'a8n', 'a7b8q', 'a7b8n']) {
      expect(ucis.some((u) => u.endsWith(x) || u === 'a7' + x)).toBe(true);
    }
    const g = new Game('1n5k/P7/8/8/8/8/8/7K w - - 0 1');
    g.playSan('axb8=N');
    expect(g.fen.split(' ')[0]).toBe('1N5k/8/8/8/8/8/8/7K');
  });

  it('échec et mat (mat du berger) et pat', () => {
    const g = new Game();
    for (const s of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) g.playSan(s);
    const st = g.status();
    expect(st).toMatchObject({ over: true, result: '1-0', reason: 'checkmate' });
    expect(g.moves[6].san).toBe('Qxf7#');
    const pat = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(gameStatus(pat)).toMatchObject({ over: true, result: '1/2-1/2', reason: 'stalemate' });
  });

  it('triple répétition', () => {
    const g = new Game();
    const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
    for (const s of cycle) g.playSan(s);
    expect(g.status().over).toBe(false);
    for (const s of cycle) g.playSan(s);
    expect(g.status()).toMatchObject({ over: true, reason: 'threefold' });
  });

  it('règle des 50 coups, et le mat prime', () => {
    const p = parseFen('7k/8/8/8/8/8/R7/K7 w - - 99 80');
    const g = new Game('7k/8/8/8/8/8/R7/K7 w - - 99 80');
    expect(gameStatus(p).over).toBe(false);
    g.playSan('Rb2');
    expect(g.status()).toMatchObject({ over: true, reason: 'fifty-moves' });
    const g2 = new Game('7k/8/6K1/8/8/8/8/R7 w - - 99 80');
    g2.playSan('Ra8#');
    expect(g2.status().reason).toBe('checkmate');
  });

  it('matériel insuffisant', () => {
    expect(parseFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(parseFen('8/8/8/4k3/8/8/8/4KN2 w - - 0 1').isInsufficientMaterial()).toBe(true);
    // Fous de même couleur (f5 et f1 : cases blanches) : nul ; couleurs opposées (g5 / f1) : non.
    expect(parseFen('8/8/8/4kb2/8/8/8/4KB2 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(parseFen('8/8/8/4k1b1/8/8/8/4KB2 w - - 0 1').isInsufficientMaterial()).toBe(false);
    expect(parseFen('8/8/8/4k3/8/8/8/3NKN2 w - - 0 1').isInsufficientMaterial()).toBe(false);
    expect(parseFen('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1').isInsufficientMaterial()).toBe(false);
  });
});

describe('FEN', () => {
  it('aller-retour sur des FEN connues', () => {
    for (const f of [
      START_FEN,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    ]) {
      expect(toFen(parseFen(f))).toBe(f);
    }
  });

  it('positions illégales rejetées', () => {
    const bad = [
      '',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1', // 7 rangées
      'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // pas de roi noir
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
      'Pnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // pion en 8e
      '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', // noir en échec avec trait aux blancs
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1',
    ];
    for (const f of bad) expect(() => parseFen(f), f).toThrow(FenError);
  });

  it('droits de roque incohérents supprimés, e.p. non capturable ignoré', () => {
    expect(toFen(parseFen('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1')).split(' ')[2]).toBe('-');
    expect(toFen(parseFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).split(' ')[3]).toBe('-');
  });
});

describe('PGN', () => {
  it('export puis import identique, avec FEN de départ', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    for (const s of ['O-O-O', 'O-O', 'Rd2', 'Rf2']) g.playSan(s);
    const pgn = exportPgn(g, { White: 'A', Black: 'B' }, '*');
    const back = parsePgn(pgn);
    expect(back.game.fen).toBe(g.fen);
    expect(back.headers.White).toBe('A');
    expect(pgn).toContain('1... O-O-O');
  });

  it('import multi-parties avec commentaires, variantes et NAG', () => {
    const text = `[Event "a"]
[Result "1-0"]

1. e4 {bien} e5 (1... c5 2. Nf3) 2. Qh5 $1 Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0

[Event "b"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 1/2-1/2
`;
    const { games, errors } = parseMultiPgn(text);
    expect(errors).toEqual([]);
    expect(games.length).toBe(2);
    expect(games[0].game.status().reason).toBe('checkmate');
    expect(games[1].game.moves.length).toBe(4);
    expect(games[1].result).toBe('1/2-1/2');
  });
});
