import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/core/fen';
import { PERFT_SUITE, perft } from '../src/core/perft';

// Profondeurs limitées pour garder la suite rapide ; `npm run perft` va plus loin.
const MAX_NODES_IN_TEST = 5_000_000;

describe('perft (validation du générateur de coups)', () => {
  for (const { name, fen, counts } of PERFT_SUITE) {
    counts.forEach((expected, i) => {
      const depth = i + 1;
      if (expected > MAX_NODES_IN_TEST) return;
      it(`${name} — profondeur ${depth} = ${expected}`, () => {
        const pos = parseFen(fen);
        const hashBefore = [pos.hashLo, pos.hashHi];
        expect(perft(pos, depth)).toBe(expected);
        // make/unmake doit restaurer exactement la position.
        expect([pos.hashLo, pos.hashHi]).toEqual(hashBefore);
      });
    });
  }
});
