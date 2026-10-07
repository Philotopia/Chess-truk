import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/core/fen';
import { pawnCells, separableModel, squareModel, toBoardTable } from '../src/engine/pawnModel';

const ADV = [0, 0, 5, 12, 25, 50, 100, 0];

describe('modèle de valeur des pions par case', () => {
  it('comptage : blancs positifs, noirs miroir négatifs', () => {
    const c = pawnCells(parseFen('4k3/3p4/8/8/4P3/8/P7/4K3 w - - 0 1'));
    expect(c[(1 - 1) * 8 + 0]).toBe(1); // a2 blanc : rangée relative 1, colonne a
    expect(c[(3 - 1) * 8 + 4]).toBe(1); // e4 blanc : rangée relative 3
    expect(c[(1 - 1) * 8 + 3]).toBe(-1); // d7 noir = sa 2e rangée, colonne d
  });

  it('les deux modèles reproduisent la table d’avancement actuelle', () => {
    for (const m of [separableModel, squareModel]) {
      const p = m.fromAdvancement(ADV);
      const t = m.table(p);
      for (let rel = 1; rel <= 6; rel++) for (let s = 0; s < 4; s++) expect(t[rel - 1][s]).toBe(ADV[rel]);
      // Caractéristiques × paramètres = somme des avancements (blancs − noirs).
      const pos = parseFen('4k3/2p2p2/8/3P4/8/1P6/P5P1/4K3 w - - 0 1');
      const f = m.features(pawnCells(pos));
      let v = 0;
      for (let i = 0; i < m.nParams; i++) v += f[i] * p[i];
      // Blancs : a2 0, b3 5, d5 25, g2 0 ; noirs : c7 0, f7 0.
      expect(v).toBe(30);
    }
  });

  it('projection monotone (règle des pions) et table 8×8', () => {
    const p = Float64Array.from([10, 5, 30, 20, 90, 3, 6, 9]);
    separableModel.project(p, true);
    const t = separableModel.table(p);
    for (let rel = 2; rel <= 6; rel++) expect(t[rel - 1][0]).toBeGreaterThanOrEqual(t[rel - 2][0]);
    const board = toBoardTable(t);
    expect(board[6 * 8 + 3]).toBe(9); // d2 : rangée 2 + colonne d/e
    expect(board[1 * 8 + 0]).toBe(90); // a7
  });
});
