import { Position } from './position';
import {
  BISHOP,
  FLAG_CAPTURE,
  FLAG_CASTLE,
  KING,
  KNIGHT,
  PAWN,
  PIECE_LETTERS,
  QUEEN,
  ROOK,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
  parseSq,
  pieceType,
  sqName,
} from './types';

const PROMO_CHARS = ['', '', 'n', 'b', 'r', 'q'];

export function moveToUci(m: number): string {
  if (m === 0) return '0000';
  const promo = movePromo(m);
  return sqName(moveFrom(m)) + sqName(moveTo(m)) + (promo ? PROMO_CHARS[promo] : '');
}

/** Retrouve le coup légal correspondant à une chaîne UCI (null si illégal). */
export function uciToMove(pos: Position, uci: string): number | null {
  const from = parseSq(uci.slice(0, 2));
  const to = parseSq(uci.slice(2, 4));
  if (from < 0 || to < 0) return null;
  const pc = uci.length > 4 ? uci[4].toLowerCase() : '';
  const promo = pc ? PROMO_CHARS.indexOf(pc) : 0;
  for (const m of pos.legalMoves()) {
    if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === (promo > 0 ? promo : 0)) return m;
  }
  return null;
}

/** Notation algébrique standard (SAN) d'un coup légal dans la position. */
export function moveToSan(pos: Position, m: number, legal: number[] = pos.legalMoves()): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const piece = pos.board[from];
  const t = pieceType(piece);
  let san: string;
  if (flags & FLAG_CASTLE) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else {
    const capture = (flags & FLAG_CAPTURE) !== 0;
    if (t === PAWN) {
      san = capture ? 'abcdefgh'[from & 7] + 'x' : '';
      san += sqName(to);
      const promo = movePromo(m);
      if (promo) san += '=' + PIECE_LETTERS[promo];
    } else {
      san = PIECE_LETTERS[t];
      // Désambiguïsation.
      let sameFile = false;
      let sameRank = false;
      let ambiguous = false;
      for (const o of legal) {
        if (o === m) continue;
        if (moveTo(o) !== to) continue;
        const of = moveFrom(o);
        if (pos.board[of] !== piece) continue;
        ambiguous = true;
        if ((of & 7) === (from & 7)) sameFile = true;
        if (of >> 4 === from >> 4) sameRank = true;
      }
      if (ambiguous) {
        if (!sameFile) san += 'abcdefgh'[from & 7];
        else if (!sameRank) san += String((from >> 4) + 1);
        else san += sqName(from);
      }
      if (capture) san += 'x';
      san += sqName(to);
    }
  }
  if (pos.makeMove(m)) {
    if (pos.inCheck()) san += pos.hasLegalMove() ? '+' : '#';
    pos.unmakeMove();
  }
  return san;
}

const SAN_PIECES: Record<string, number> = { N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING };

/** Analyse tolérante d'un coup SAN (accepte 0-0, e8Q, suffixes +#!?). Retourne null si illégal. */
export function sanToMove(pos: Position, sanIn: string): number | null {
  let san = sanIn.trim().replace(/[+#!?]+$/g, '').replace(/[+#]/g, '');
  san = san.replace(/0/g, 'O');
  const legal = pos.legalMoves();
  if (san === 'O-O' || san === 'O-O-O') {
    for (const m of legal) {
      if (moveFlags(m) & FLAG_CASTLE) {
        const ks = moveTo(m) > moveFrom(m);
        if ((san === 'O-O') === ks) return m;
      }
    }
    return null;
  }
  // Format UCI accepté en secours.
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(san)) {
    const m = uciToMove(pos, san);
    if (m !== null) return m;
  }
  const re = /^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(=?([NBRQnbrq]))?$/;
  const mt = re.exec(san);
  if (!mt) return null;
  const pt = mt[1] ? SAN_PIECES[mt[1]] : PAWN;
  const fromFile = mt[2] ? mt[2].charCodeAt(0) - 97 : -1;
  const fromRank = mt[3] ? mt[3].charCodeAt(0) - 49 : -1;
  const to = parseSq(mt[5]);
  const promo = mt[7] ? SAN_PIECES[mt[7].toUpperCase()] : 0;
  const cands: number[] = [];
  for (const m of legal) {
    if (moveTo(m) !== to) continue;
    const from = moveFrom(m);
    if (pieceType(pos.board[from]) !== pt) continue;
    if (fromFile >= 0 && (from & 7) !== fromFile) continue;
    if (fromRank >= 0 && from >> 4 !== fromRank) continue;
    if (movePromo(m) !== promo) continue;
    cands.push(m);
  }
  return cands.length === 1 ? cands[0] : null;
}

/** Convertit une suite de coups UCI en SAN à partir d'une position (copie). */
export function uciLineToSan(pos: Position, line: string[]): string[] {
  const p = pos.clone();
  const out: string[] = [];
  for (const u of line) {
    const m = uciToMove(p, u);
    if (m === null) break;
    out.push(moveToSan(p, m));
    p.makeMove(m);
  }
  return out;
}

/** Ligne SAN numérotée, ex. « 12. Nf3 d5 13. exd5 ». */
export function formatSanLine(sans: string[], startFullmove: number, whiteToMove: boolean): string {
  let s = '';
  let fm = startFullmove;
  let white = whiteToMove;
  sans.forEach((san, i) => {
    if (white) s += `${fm}. `;
    else if (i === 0) s += `${fm}... `;
    s += san + ' ';
    if (!white) fm++;
    white = !white;
  });
  return s.trim();
}
