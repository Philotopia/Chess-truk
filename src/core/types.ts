// Représentation de base : plateau 0x88 (128 cases, dont 64 valides).
// Une case valide vérifie (sq & 0x88) === 0. sq = rang * 16 + colonne, a1 = 0, h8 = 0x77.

export type Color = 0 | 1;
export const WHITE: Color = 0;
export const BLACK: Color = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** Pièce codée : type | (couleur << 3). Blancs 1..6, noirs 9..14. */
export function makePiece(color: Color, type: number): number {
  return type | (color << 3);
}
export function pieceType(p: number): number {
  return p & 7;
}
export function pieceColor(p: number): Color {
  return (p >> 3) as Color;
}

export const PIECE_CHARS = ' PNBRQK  pnbrqk';
export const PIECE_NAMES_FR = ['', 'Pion', 'Cavalier', 'Fou', 'Tour', 'Dame', 'Roi'];
export const PIECE_LETTERS = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];

export function pieceFromChar(c: string): number {
  const i = PIECE_CHARS.indexOf(c);
  return i > 0 && c !== ' ' ? i : EMPTY;
}

export function sqFile(sq: number): number {
  return sq & 7;
}
export function sqRank(sq: number): number {
  return sq >> 4;
}
export function makeSq(file: number, rank: number): number {
  return rank * 16 + file;
}
export function onBoard(sq: number): boolean {
  return (sq & 0x88) === 0;
}
/** Indice 0..63 (a1 = 0, h8 = 63). */
export function sq64(sq: number): number {
  return (sq >> 4) * 8 + (sq & 7);
}
export function sq128(i: number): number {
  return (i >> 3) * 16 + (i & 7);
}
export function sqName(sq: number): string {
  return 'abcdefgh'[sq & 7] + String((sq >> 4) + 1);
}
export function parseSq(name: string): number {
  if (name.length !== 2) return -1;
  const f = name.charCodeAt(0) - 97;
  const r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 16 + f;
}

// Codage des coups dans un entier :
// bits 0-6 : départ, 7-13 : arrivée, 14-16 : pièce de promotion, 17-20 : drapeaux.
export const FLAG_CAPTURE = 1;
export const FLAG_DOUBLE = 2;
export const FLAG_EP = 4;
export const FLAG_CASTLE = 8;

export const NULL_MOVE = 0;

export function encodeMove(from: number, to: number, promo = 0, flags = 0): number {
  return from | (to << 7) | (promo << 14) | (flags << 17);
}
export function moveFrom(m: number): number {
  return m & 0x7f;
}
export function moveTo(m: number): number {
  return (m >> 7) & 0x7f;
}
export function movePromo(m: number): number {
  return (m >> 14) & 7;
}
export function moveFlags(m: number): number {
  return (m >> 17) & 15;
}
export function isCapture(m: number): boolean {
  return (moveFlags(m) & FLAG_CAPTURE) !== 0;
}

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
