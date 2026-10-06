import { Position } from './position';
import {
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  EMPTY,
  KING,
  PAWN,
  PIECE_CHARS,
  ROOK,
  WHITE,
  makePiece,
  parseSq,
  pieceFromChar,
  pieceType,
  sqName,
} from './types';

export class FenError extends Error {}

/**
 * Charge une FEN et valide la légalité élémentaire de la position.
 * Lève FenError si la position est mal formée ou illégale.
 */
export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new FenError('FEN incomplète : il faut au moins le placement et le trait.');
  const [placement, sideStr, castleStr = '-', epStr = '-', hmStr = '0', fmStr = '1'] = parts;
  const pos = new Position();
  const rows = placement.split('/');
  if (rows.length !== 8) throw new FenError('Le placement doit contenir 8 rangées.');
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') {
        file += ch.charCodeAt(0) - 48;
      } else {
        const p = pieceFromChar(ch);
        if (p === EMPTY) throw new FenError(`Caractère invalide « ${ch} » dans le placement.`);
        if (file > 7) throw new FenError(`Rangée ${rank + 1} trop longue.`);
        pos.board[rank * 16 + file] = p;
        file++;
      }
    }
    if (file !== 8) throw new FenError(`Rangée ${rank + 1} : ${file} colonnes au lieu de 8.`);
  }
  if (sideStr !== 'w' && sideStr !== 'b') throw new FenError('Trait invalide (w ou b attendu).');
  pos.side = sideStr === 'w' ? WHITE : BLACK;

  // Validation du matériel.
  const cnt = new Array(16).fill(0);
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    cnt[p]++;
    if (pieceType(p) === PAWN && ((sq >> 4) === 0 || (sq >> 4) === 7)) {
      throw new FenError(`Pion sur la première ou dernière rangée (${sqName(sq)}).`);
    }
  }
  if (cnt[KING] !== 1 || cnt[KING | 8] !== 1) throw new FenError('Chaque camp doit avoir exactement un roi.');
  for (const c of [0, 1]) {
    let total = 0;
    for (let t = 1; t <= 6; t++) total += cnt[t | (c << 3)];
    if (total > 16) throw new FenError('Plus de 16 pièces pour un camp.');
    if (cnt[PAWN | (c << 3)] > 8) throw new FenError('Plus de 8 pions pour un camp.');
  }

  // Roques : on ne conserve que les droits cohérents avec la position du roi et de la tour.
  let castling = 0;
  if (castleStr !== '-') {
    for (const ch of castleStr) {
      if (ch === 'K') castling |= CASTLE_WK;
      else if (ch === 'Q') castling |= CASTLE_WQ;
      else if (ch === 'k') castling |= CASTLE_BK;
      else if (ch === 'q') castling |= CASTLE_BQ;
      else throw new FenError(`Droit de roque invalide « ${ch} ».`);
    }
  }
  const b = pos.board;
  if (b[0x04] !== KING) castling &= ~(CASTLE_WK | CASTLE_WQ);
  if (b[0x07] !== ROOK) castling &= ~CASTLE_WK;
  if (b[0x00] !== ROOK) castling &= ~CASTLE_WQ;
  if (b[0x74] !== (KING | 8)) castling &= ~(CASTLE_BK | CASTLE_BQ);
  if (b[0x77] !== (ROOK | 8)) castling &= ~CASTLE_BK;
  if (b[0x70] !== (ROOK | 8)) castling &= ~CASTLE_BQ;
  pos.castling = castling;

  // En passant : retenu seulement s'il est cohérent et qu'une capture est géométriquement possible.
  pos.ep = -1;
  if (epStr !== '-') {
    const ep = parseSq(epStr);
    if (ep < 0) throw new FenError(`Case en passant invalide « ${epStr} ».`);
    const expectedRank = pos.side === WHITE ? 5 : 2;
    if (ep >> 4 === expectedRank) {
      const them = pos.side ^ 1;
      const pawnSq = pos.side === WHITE ? ep - 16 : ep + 16;
      const origSq = pos.side === WHITE ? ep + 16 : ep - 16;
      const ourPawn = makePiece(pos.side, PAWN);
      if (b[pawnSq] === makePiece(them as 0 | 1, PAWN) && b[ep] === EMPTY && b[origSq] === EMPTY) {
        const l = pawnSq - 1;
        const r = pawnSq + 1;
        if ((!(l & 0x88) && b[l] === ourPawn) || (!(r & 0x88) && b[r] === ourPawn)) pos.ep = ep;
      }
    }
  }
  const hm = parseInt(hmStr, 10);
  const fm = parseInt(fmStr, 10);
  pos.halfmove = Number.isFinite(hm) && hm >= 0 ? hm : 0;
  pos.fullmove = Number.isFinite(fm) && fm >= 1 ? fm : 1;
  pos.reset();

  // Le camp qui n'a pas le trait ne peut pas être en échec.
  const notToMove = (pos.side ^ 1) as 0 | 1;
  if (pos.isAttacked(pos.kingSq[notToMove], pos.side)) {
    throw new FenError('Position illégale : le camp qui n’a pas le trait est en échec.');
  }
  return pos;
}

export function toFen(pos: Position): string {
  let s = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 16 + file];
      if (p === EMPTY) {
        empty++;
      } else {
        if (empty) {
          s += empty;
          empty = 0;
        }
        s += PIECE_CHARS[p];
      }
    }
    if (empty) s += empty;
    if (rank > 0) s += '/';
  }
  s += pos.side === WHITE ? ' w ' : ' b ';
  let c = '';
  if (pos.castling & CASTLE_WK) c += 'K';
  if (pos.castling & CASTLE_WQ) c += 'Q';
  if (pos.castling & CASTLE_BK) c += 'k';
  if (pos.castling & CASTLE_BQ) c += 'q';
  s += (c || '-') + ' ';
  s += (pos.ep >= 0 ? sqName(pos.ep) : '-') + ' ';
  s += pos.halfmove + ' ' + pos.fullmove;
  return s;
}

/** Vérifie une FEN sans lever d'exception. */
export function validateFen(fen: string): { ok: true } | { ok: false; error: string } {
  try {
    parseFen(fen);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

