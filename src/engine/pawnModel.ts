// Valeur positionnelle des pions selon leur case (rangée = vertical, colonne = horizontal).
//
// Deux modèles, ancrés sur « pion en a2 = 100 » (valeur matérielle du pion) :
//   - « rangée + colonne » (séparable) : V(r, c) = A[r] + F[c], colonnes symétriques (a=h, b=g, c=f, d=e) ;
//   - « case par case » : une valeur par (rangée, colonne symétrique), soit 24 valeurs.
// Règle du projet (option `monotone`) : à colonne égale, un pion plus avancé ne vaut jamais moins.

import type { Position } from '../core/position';
import { PAWN } from '../core/types';

/** Colonne symétrique : 0 = a/h, 1 = b/g, 2 = c/f, 3 = d/e. */
export const symFile = (f: number) => (f < 4 ? f : 7 - f);
export const FILE_NAMES = ['a/h', 'b/g', 'c/f', 'd/e'];

/**
 * Comptage des pions par (rangée relative 1..6, colonne) : blancs +1, noirs −1 (rangée miroir).
 * Index = (rangée relative − 1) × 8 + colonne. Rangée relative 1 = 2e rangée.
 */
export function pawnCells(pos: Position): Int8Array {
  const cells = new Int8Array(48);
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if ((p & 7) !== PAWN) continue;
    const white = p >> 3 === 0;
    const r = sq >> 4;
    const rel = white ? r : 7 - r;
    if (rel < 1 || rel > 6) continue;
    cells[(rel - 1) * 8 + (sq & 7)] += white ? 1 : -1;
  }
  return cells;
}

export type PawnModelKind = 'separable' | 'square';

export interface PawnModel {
  kind: PawnModelKind;
  /** Noms lisibles des paramètres. */
  names: string[];
  /** Index (dans la table 6×4 rangée × colonne symétrique) influencés par chaque paramètre. */
  nParams: number;
  /** Table 6 × 4 (rangée relative 1..6 × colonne symétrique) à partir des paramètres. */
  table(params: Float64Array): number[][];
  /** Caractéristiques (dérivées de l'éval par rapport à chaque paramètre) à partir du comptage des pions. */
  features(cells: Int8Array): Float32Array;
  /** Projection sur les contraintes (monotonie en rangée si demandée). */
  project(params: Float64Array, monotone: boolean): void;
  /** Paramètres reproduisant une table d'avancement par rangée (colonnes neutres). */
  fromAdvancement(adv: number[]): Float64Array;
}

export const separableModel: PawnModel = {
  kind: 'separable',
  names: ['rangée 3', 'rangée 4', 'rangée 5', 'rangée 6', 'rangée 7', 'colonne b/g', 'colonne c/f', 'colonne d/e'],
  nParams: 8,
  table(p) {
    const A = [0, p[0], p[1], p[2], p[3], p[4]];
    const F = [0, p[5], p[6], p[7]];
    return A.map((a) => F.map((f) => a + f));
  },
  features(cells) {
    const out = new Float32Array(8);
    for (let rel = 1; rel <= 6; rel++) {
      for (let f = 0; f < 8; f++) {
        const n = cells[(rel - 1) * 8 + f];
        if (!n) continue;
        if (rel >= 2) out[rel - 2] += n;
        const s = symFile(f);
        if (s >= 1) out[4 + s] += n;
      }
    }
    return out;
  },
  project(p, monotone) {
    if (!monotone) return;
    let prev = 0;
    for (let k = 0; k < 5; k++) {
      if (p[k] < prev) p[k] = prev;
      prev = p[k];
    }
  },
  fromAdvancement(adv) {
    return Float64Array.from([adv[2], adv[3], adv[4], adv[5], adv[6], 0, 0, 0]);
  },
};

/** Index du paramètre « case par case » ; (rangée 2, a/h) est l'ancre fixe (−1). */
function sqIndex(rel: number, s: number): number {
  const i = (rel - 1) * 4 + s;
  return i === 0 ? -1 : i - 1;
}

export const squareModel: PawnModel = {
  kind: 'square',
  names: Array.from({ length: 24 }, (_, i) => `rangée ${Math.floor(i / 4) + 2} ${FILE_NAMES[i % 4]}`).slice(1),
  nParams: 23,
  table(p) {
    const t: number[][] = [];
    for (let rel = 1; rel <= 6; rel++) {
      const row: number[] = [];
      for (let s = 0; s < 4; s++) {
        const i = sqIndex(rel, s);
        row.push(i < 0 ? 0 : p[i]);
      }
      t.push(row);
    }
    return t;
  },
  features(cells) {
    const out = new Float32Array(23);
    for (let rel = 1; rel <= 6; rel++) {
      for (let f = 0; f < 8; f++) {
        const n = cells[(rel - 1) * 8 + f];
        if (!n) continue;
        const i = sqIndex(rel, symFile(f));
        if (i >= 0) out[i] += n;
      }
    }
    return out;
  },
  project(p, monotone) {
    if (!monotone) return;
    for (let s = 0; s < 4; s++) {
      let prev = -Infinity;
      for (let rel = 1; rel <= 6; rel++) {
        const i = sqIndex(rel, s);
        const v = i < 0 ? 0 : p[i];
        if (v < prev && i >= 0) p[i] = prev;
        prev = i < 0 ? 0 : p[i];
      }
    }
  },
  fromAdvancement(adv) {
    const p = new Float64Array(23);
    for (let rel = 1; rel <= 6; rel++) for (let s = 0; s < 4; s++) {
      const i = sqIndex(rel, s);
      if (i >= 0) p[i] = adv[rel];
    }
    return p;
  },
};

/** Table 8×8 (ordre a8…h1, point de vue des blancs) d'une table 6×4 rangée × colonne symétrique. */
export function toBoardTable(t: number[][]): number[] {
  const out = new Array(64).fill(0);
  for (let rel = 1; rel <= 6; rel++) for (let f = 0; f < 8; f++) out[(7 - rel) * 8 + f] = Math.round(t[rel - 1][symFile(f)]);
  return out;
}
