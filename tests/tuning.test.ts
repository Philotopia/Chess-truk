import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/core/fen';
import { Game } from '../src/core/game';
import { evaluateDetailed } from '../src/engine/evaluate';
import { defaultEvalParams } from '../src/engine/params';
import { TUNE_SPEC, extractFeatures, linearEval, paramIndex, project, readVector } from '../src/engine/tuning';

function randomFens(n: number): string[] {
  let s = 11;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const out: string[] = [];
  while (out.length < n) {
    const g = new Game();
    const len = 6 + Math.floor(rand() * 120);
    for (let i = 0; i < len; i++) {
      const ms = g.pos.legalMoves();
      if (!ms.length) break;
      g.play(ms[Math.floor(rand() * ms.length)]);
    }
    out.push(g.fen);
  }
  return out;
}

describe('réglage Texel', () => {
  const params = defaultEvalParams();
  const v = readVector(params);

  it('la décomposition linéaire reproduit l’évaluation (à l’arrondi de la pression sur le roi près)', () => {
    for (const fen of [...randomFens(300), '8/8/8/8/2k5/3q4/5K2/8 w - - 41 136']) {
      const pos = parseFen(fen);
      const f = extractFeatures(pos, params);
      // Le malus de pression sur le roi est arrondi à l'entier (≤ 0,5 cp par camp).
      expect(Math.abs(linearEval(f, v) - evaluateDetailed(pos, params).exact)).toBeLessThanOrEqual(1);
    }
  });

  it('règle des pions : avancement et PST des pions ne sont pas réglables', () => {
    expect(TUNE_SPEC.some((p) => p.path.startsWith('pawnAdvancement'))).toBe(false);
    expect(TUNE_SPEC.some((p) => p.path.startsWith('psqt.pawn'))).toBe(false);
    expect(TUNE_SPEC.some((p) => p.path === 'pieceValues.pawn')).toBe(false);
  });

  it('projection : pions passés ≥ 0 et croissants', () => {
    const w = readVector(params);
    w[paramIndex('passedPawn.eg.3')] = -50;
    w[paramIndex('passedPawn.eg.5')] = 10;
    w[paramIndex('passedPawn.eg.4')] = 80;
    project(w);
    const eg = [1, 2, 3, 4, 5, 6].map((r) => w[paramIndex(`passedPawn.eg.${r}`)]);
    for (let i = 1; i < eg.length; i++) expect(eg[i]).toBeGreaterThanOrEqual(eg[i - 1]);
    expect(Math.min(...eg)).toBeGreaterThanOrEqual(0);
  });
});
