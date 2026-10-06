// SEE (Static Exchange Evaluation) : bilan matériel d'une suite de captures sur une case,
// chaque camp capturant avec sa pièce la moins chère (rayons X compris). Les clouages sont ignorés.

import { BISHOP_DIRS, KING_OFFSETS, KNIGHT_OFFSETS, type Position, ROOK_DIRS } from '../core/position';
import { BISHOP, type Color, EMPTY, FLAG_EP, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, moveFlags, moveFrom, movePromo, moveTo } from '../core/types';

export const SEE_VALUE = [0, 100, 320, 330, 500, 900, 10000];

const removed = new Uint8Array(128);
const removedList = new Int16Array(40);
let nRemoved = 0;
const gain = new Int32Array(40);

function occupied(b: Int8Array, s: number): number {
  return removed[s] ? EMPTY : b[s];
}

/** Case de l'attaquant le moins cher de `side` sur `to` (en ignorant les pièces retirées), -1 si aucun. */
function leastAttacker(pos: Position, to: number, side: Color): number {
  const b = pos.board;
  const cb = side << 3;
  // Pions.
  const pawn = PAWN | cb;
  const p1 = side === WHITE ? to - 15 : to + 15;
  const p2 = side === WHITE ? to - 17 : to + 17;
  if (!(p1 & 0x88) && occupied(b, p1) === pawn) return p1;
  if (!(p2 & 0x88) && occupied(b, p2) === pawn) return p2;
  const knight = KNIGHT | cb;
  for (let i = 0; i < 8; i++) {
    const s = to + KNIGHT_OFFSETS[i];
    if (!(s & 0x88) && occupied(b, s) === knight) return s;
  }
  let bestSq = -1;
  let bestVal = 1 << 30;
  const bishop = BISHOP | cb;
  const rook = ROOK | cb;
  const queen = QUEEN | cb;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_DIRS[i];
    let s = to + d;
    while (!(s & 0x88)) {
      const p = occupied(b, s);
      if (p !== EMPTY) {
        if ((p === bishop || p === queen) && SEE_VALUE[p & 7] < bestVal) {
          bestVal = SEE_VALUE[p & 7];
          bestSq = s;
        }
        break;
      }
      s += d;
    }
  }
  if (bestVal <= SEE_VALUE[BISHOP]) return bestSq;
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DIRS[i];
    let s = to + d;
    while (!(s & 0x88)) {
      const p = occupied(b, s);
      if (p !== EMPTY) {
        if ((p === rook || p === queen) && SEE_VALUE[p & 7] < bestVal) {
          bestVal = SEE_VALUE[p & 7];
          bestSq = s;
        }
        break;
      }
      s += d;
    }
  }
  if (bestSq >= 0) return bestSq;
  const king = KING | cb;
  for (let i = 0; i < 8; i++) {
    const s = to + KING_OFFSETS[i];
    if (!(s & 0x88) && occupied(b, s) === king) return s;
  }
  return -1;
}

function remove(s: number): void {
  removed[s] = 1;
  removedList[nRemoved++] = s;
}

/** Gain matériel attendu (centipawns) du coup, du point de vue du camp qui le joue. */
export function see(pos: Position, m: number): number {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const promo = movePromo(m);
  const captured = flags & FLAG_EP ? PAWN : b[to] & 7;
  nRemoved = 0;
  let d = 0;
  gain[0] = SEE_VALUE[captured];
  let onSquare = b[from] & 7;
  if (promo) {
    gain[0] += SEE_VALUE[promo] - SEE_VALUE[PAWN];
    onSquare = promo;
  }
  remove(from);
  if (flags & FLAG_EP) remove(pos.side === WHITE ? to - 16 : to + 16);
  let side = (pos.side ^ 1) as Color;
  for (;;) {
    const sq = leastAttacker(pos, to, side);
    if (sq < 0) break;
    const attacker = b[sq] & 7;
    // Le roi ne peut pas capturer sur une case encore défendue.
    if (attacker === KING && leastAttacker(pos, to, (side ^ 1) as Color) >= 0) break;
    d++;
    gain[d] = SEE_VALUE[onSquare] - gain[d - 1];
    if (Math.max(-gain[d - 1], gain[d]) < 0) break;
    onSquare = attacker;
    remove(sq);
    side = (side ^ 1) as Color;
  }
  while (d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
    d--;
  }
  for (let i = 0; i < nRemoved; i++) removed[removedList[i]] = 0;
  return gain[0];
}
