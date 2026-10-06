import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/core/fen';
import { uciToMove } from '../src/core/notation';
import { see } from '../src/engine/see';

function seeOf(fen: string, uci: string): number {
  const pos = parseFen(fen);
  const m = uciToMove(pos, uci);
  if (m === null) throw new Error('coup illégal ' + uci);
  return see(pos, m);
}

describe('SEE (évaluation statique des échanges)', () => {
  it('pièce non défendue', () => {
    expect(seeOf('4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1', 'e3d5')).toBe(900);
  });
  it('pion prend cavalier défendu par un pion', () => {
    expect(seeOf('4k3/8/2p5/3n4/4P3/8/8/4K3 w - - 0 1', 'e4d5')).toBe(320 - 100);
  });
  it('dame prend pion défendu : perdant', () => {
    expect(seeOf('4k3/8/2p5/3p4/8/8/3Q4/4K3 w - - 0 1', 'd2d5')).toBe(100 - 900);
  });
  it('rayons X : tours doublées contre une tour défendue', () => {
    // Txd8 Txd8 Txd8 : les blancs gagnent une tour.
    expect(seeOf('3r2k1/8/8/8/8/8/3R4/3R2K1 w - - 0 1', 'd2d8')).toBe(500);
    // Une seule tour blanche contre tour défendue : échange égal.
    expect(seeOf('3r1rk1/8/8/8/8/8/8/3R2K1 w - - 0 1', 'd1d8')).toBe(0);
  });
  it('le roi ne recapture pas sur une case défendue', () => {
    // Fxf7+ : le roi noir ne peut pas reprendre car la dame h5 défend f7.
    expect(seeOf('4k3/5p2/8/7Q/2B5/8/8/4K3 w - - 0 1', 'c4f7')).toBe(100);
  });
  it('promotion avec capture', () => {
    expect(seeOf('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7b8q')).toBe(500 + 900 - 100);
  });
});
