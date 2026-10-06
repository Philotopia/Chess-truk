import {
  BISHOP,
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  type Color,
  EMPTY,
  FLAG_CAPTURE,
  FLAG_CASTLE,
  FLAG_DOUBLE,
  FLAG_EP,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  encodeMove,
  makePiece,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
  pieceColor,
  pieceType,
} from './types';
import {
  Z_CASTLE_HI,
  Z_CASTLE_LO,
  Z_EP_HI,
  Z_EP_LO,
  Z_PIECE_HI,
  Z_PIECE_LO,
  Z_SIDE_HI,
  Z_SIDE_LO,
} from './zobrist';

export const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
export const BISHOP_DIRS = [15, 17, -15, -17];
export const ROOK_DIRS = [1, -1, 16, -16];
export const KING_OFFSETS = [1, -1, 16, -16, 15, 17, -15, -17];

/** Masque appliqué aux droits de roque quand une pièce quitte ou atteint la case. */
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~CASTLE_WQ; // a1
CASTLE_MASK[0x07] = 15 & ~CASTLE_WK; // h1
CASTLE_MASK[0x04] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[0x70] = 15 & ~CASTLE_BQ; // a8
CASTLE_MASK[0x77] = 15 & ~CASTLE_BK; // h8
CASTLE_MASK[0x74] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8

/** Capacité maximale de l'historique (partie + recherche). */
export const MAX_HISTORY = 4096;

/**
 * Position d'échecs mutable avec make/unmake incrémental.
 * Les coups sont pseudo-légaux à la génération ; la légalité est vérifiée par makeMove().
 */
export class Position {
  board = new Int8Array(128);
  side: Color = WHITE;
  castling = 0;
  /** Case en passant (cible), -1 si aucune. N'est posée que si un pion adverse peut capturer. */
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kingSq = [0, 0];
  hashLo = 0;
  hashHi = 0;
  /** Nombre de pièces par code (0..15). */
  counts = new Int8Array(16);

  /** Nombre de demi-coups joués depuis la position chargée. */
  ply = 0;
  private uMove = new Int32Array(MAX_HISTORY);
  private uCaptured = new Int8Array(MAX_HISTORY);
  private uCastling = new Uint8Array(MAX_HISTORY);
  private uEp = new Int16Array(MAX_HISTORY);
  private uHalfmove = new Int16Array(MAX_HISTORY);
  /** Hachage de la position après ply demi-coups (index 0 = position initiale). */
  histLo = new Int32Array(MAX_HISTORY + 1);
  histHi = new Int32Array(MAX_HISTORY + 1);

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.side = this.side;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kingSq = [this.kingSq[0], this.kingSq[1]];
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    p.counts.set(this.counts);
    p.ply = this.ply;
    p.uMove.set(this.uMove);
    p.uCaptured.set(this.uCaptured);
    p.uCastling.set(this.uCastling);
    p.uEp.set(this.uEp);
    p.uHalfmove.set(this.uHalfmove);
    p.histLo.set(this.histLo);
    p.histHi.set(this.histHi);
    return p;
  }

  /** Recalcule entièrement hachage, compteurs et rois (après un chargement FEN). */
  reset(): void {
    this.counts.fill(0);
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = this.board[sq];
      if (p === EMPTY) continue;
      this.counts[p]++;
      lo ^= Z_PIECE_LO[p * 128 + sq];
      hi ^= Z_PIECE_HI[p * 128 + sq];
      if (pieceType(p) === KING) this.kingSq[pieceColor(p)] = sq;
    }
    lo ^= Z_CASTLE_LO[this.castling];
    hi ^= Z_CASTLE_HI[this.castling];
    if (this.ep >= 0) {
      lo ^= Z_EP_LO[this.ep & 7];
      hi ^= Z_EP_HI[this.ep & 7];
    }
    if (this.side === BLACK) {
      lo ^= Z_SIDE_LO;
      hi ^= Z_SIDE_HI;
    }
    this.hashLo = lo;
    this.hashHi = hi;
    this.ply = 0;
    this.histLo[0] = lo;
    this.histHi[0] = hi;
  }

  /** Vrai si la case est attaquée par la couleur `by`. */
  isAttacked(sq: number, by: Color): boolean {
    const b = this.board;
    // Pions : un pion blanc attaque sq depuis sq-15 / sq-17.
    if (by === WHITE) {
      let s = sq - 15;
      if (!(s & 0x88) && b[s] === PAWN) return true;
      s = sq - 17;
      if (!(s & 0x88) && b[s] === PAWN) return true;
    } else {
      const bp = PAWN | 8;
      let s = sq + 15;
      if (!(s & 0x88) && b[s] === bp) return true;
      s = sq + 17;
      if (!(s & 0x88) && b[s] === bp) return true;
    }
    const cb = by << 3;
    const knight = KNIGHT | cb;
    for (let i = 0; i < 8; i++) {
      const s = sq + KNIGHT_OFFSETS[i];
      if (!(s & 0x88) && b[s] === knight) return true;
    }
    const king = KING | cb;
    for (let i = 0; i < 8; i++) {
      const s = sq + KING_OFFSETS[i];
      if (!(s & 0x88) && b[s] === king) return true;
    }
    const bishop = BISHOP | cb;
    const rook = ROOK | cb;
    const queen = QUEEN | cb;
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      let s = sq + d;
      while (!(s & 0x88)) {
        const p = b[s];
        if (p !== EMPTY) {
          if (p === bishop || p === queen) return true;
          break;
        }
        s += d;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i];
      let s = sq + d;
      while (!(s & 0x88)) {
        const p = b[s];
        if (p !== EMPTY) {
          if (p === rook || p === queen) return true;
          break;
        }
        s += d;
      }
    }
    return false;
  }

  inCheck(color: Color = this.side): boolean {
    return this.isAttacked(this.kingSq[color], (color ^ 1) as Color);
  }

  /**
   * Génère les coups pseudo-légaux dans `out` à partir de l'indice `start`.
   * Retourne l'indice de fin. Si capturesOnly, ne génère que captures et promotions.
   * Les roques générés sont légaux (cases traversées non attaquées).
   */
  generateMoves(out: Int32Array | number[], start: number, capturesOnly = false): number {
    const b = this.board;
    const us = this.side;
    const them = (us ^ 1) as Color;
    let n = start;
    for (let from = 0; from < 128; from++) {
      if (from & 0x88) {
        from += 7;
        continue;
      }
      const p = b[from];
      if (p === EMPTY || pieceColor(p) !== us) continue;
      const t = pieceType(p);
      if (t === PAWN) {
        const dir = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6;
        const promoRank = us === WHITE ? 7 : 0;
        const to = from + dir;
        if (!(to & 0x88) && b[to] === EMPTY) {
          if (to >> 4 === promoRank) {
            out[n++] = encodeMove(from, to, QUEEN);
            out[n++] = encodeMove(from, to, KNIGHT);
            out[n++] = encodeMove(from, to, ROOK);
            out[n++] = encodeMove(from, to, BISHOP);
          } else if (!capturesOnly) {
            out[n++] = encodeMove(from, to);
            const to2 = to + dir;
            if (from >> 4 === startRank && b[to2] === EMPTY) {
              out[n++] = encodeMove(from, to2, 0, FLAG_DOUBLE);
            }
          }
        }
        for (let k = 0; k < 2; k++) {
          const cto = from + dir + (k === 0 ? -1 : 1);
          if (cto & 0x88) continue;
          const c = b[cto];
          if (c !== EMPTY && pieceColor(c) === them) {
            if (cto >> 4 === promoRank) {
              out[n++] = encodeMove(from, cto, QUEEN, FLAG_CAPTURE);
              out[n++] = encodeMove(from, cto, KNIGHT, FLAG_CAPTURE);
              out[n++] = encodeMove(from, cto, ROOK, FLAG_CAPTURE);
              out[n++] = encodeMove(from, cto, BISHOP, FLAG_CAPTURE);
            } else {
              out[n++] = encodeMove(from, cto, 0, FLAG_CAPTURE);
            }
          } else if (cto === this.ep) {
            out[n++] = encodeMove(from, cto, 0, FLAG_CAPTURE | FLAG_EP);
          }
        }
      } else if (t === KNIGHT || t === KING) {
        const offs = t === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (let i = 0; i < 8; i++) {
          const to = from + offs[i];
          if (to & 0x88) continue;
          const c = b[to];
          if (c === EMPTY) {
            if (!capturesOnly) out[n++] = encodeMove(from, to);
          } else if (pieceColor(c) === them) {
            out[n++] = encodeMove(from, to, 0, FLAG_CAPTURE);
          }
        }
      } else {
        const dirs = t === BISHOP ? BISHOP_DIRS : t === ROOK ? ROOK_DIRS : KING_OFFSETS;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          let to = from + d;
          while (!(to & 0x88)) {
            const c = b[to];
            if (c === EMPTY) {
              if (!capturesOnly) out[n++] = encodeMove(from, to);
            } else {
              if (pieceColor(c) === them) out[n++] = encodeMove(from, to, 0, FLAG_CAPTURE);
              break;
            }
            to += d;
          }
        }
      }
    }
    if (!capturesOnly) n = this.generateCastles(out, n);
    return n;
  }

  private generateCastles(out: Int32Array | number[], n: number): number {
    const b = this.board;
    const us = this.side;
    const them = (us ^ 1) as Color;
    if (us === WHITE) {
      if (this.castling & CASTLE_WK && b[0x05] === EMPTY && b[0x06] === EMPTY && b[0x04] === KING && b[0x07] === ROOK) {
        if (!this.isAttacked(0x04, them) && !this.isAttacked(0x05, them) && !this.isAttacked(0x06, them)) {
          out[n++] = encodeMove(0x04, 0x06, 0, FLAG_CASTLE);
        }
      }
      if (
        this.castling & CASTLE_WQ &&
        b[0x03] === EMPTY &&
        b[0x02] === EMPTY &&
        b[0x01] === EMPTY &&
        b[0x04] === KING &&
        b[0x00] === ROOK
      ) {
        if (!this.isAttacked(0x04, them) && !this.isAttacked(0x03, them) && !this.isAttacked(0x02, them)) {
          out[n++] = encodeMove(0x04, 0x02, 0, FLAG_CASTLE);
        }
      }
    } else {
      const bk = KING | 8;
      const br = ROOK | 8;
      if (this.castling & CASTLE_BK && b[0x75] === EMPTY && b[0x76] === EMPTY && b[0x74] === bk && b[0x77] === br) {
        if (!this.isAttacked(0x74, them) && !this.isAttacked(0x75, them) && !this.isAttacked(0x76, them)) {
          out[n++] = encodeMove(0x74, 0x76, 0, FLAG_CASTLE);
        }
      }
      if (
        this.castling & CASTLE_BQ &&
        b[0x73] === EMPTY &&
        b[0x72] === EMPTY &&
        b[0x71] === EMPTY &&
        b[0x74] === bk &&
        b[0x70] === br
      ) {
        if (!this.isAttacked(0x74, them) && !this.isAttacked(0x73, them) && !this.isAttacked(0x72, them)) {
          out[n++] = encodeMove(0x74, 0x72, 0, FLAG_CASTLE);
        }
      }
    }
    return n;
  }

  private putPiece(sq: number, p: number): void {
    this.board[sq] = p;
    this.hashLo ^= Z_PIECE_LO[p * 128 + sq];
    this.hashHi ^= Z_PIECE_HI[p * 128 + sq];
  }
  private removePiece(sq: number): void {
    const p = this.board[sq];
    this.board[sq] = EMPTY;
    this.hashLo ^= Z_PIECE_LO[p * 128 + sq];
    this.hashHi ^= Z_PIECE_HI[p * 128 + sq];
  }

  /**
   * Joue un coup pseudo-légal. Retourne false (et annule le coup) s'il laisse le roi en échec.
   */
  makeMove(m: number): boolean {
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const promo = movePromo(m);
    const b = this.board;
    const piece = b[from];
    const us = this.side;
    const them = (us ^ 1) as Color;
    const ply = this.ply;

    this.uMove[ply] = m;
    this.uCastling[ply] = this.castling;
    this.uEp[ply] = this.ep;
    this.uHalfmove[ply] = this.halfmove;

    if (this.ep >= 0) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
    this.ep = -1;

    let captured = EMPTY;
    if (flags & FLAG_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      captured = b[capSq];
      this.removePiece(capSq);
      this.counts[captured]--;
    } else if (b[to] !== EMPTY) {
      captured = b[to];
      this.removePiece(to);
      this.counts[captured]--;
    }
    this.uCaptured[ply] = captured;

    this.removePiece(from);
    if (promo) {
      const pp = makePiece(us, promo);
      this.putPiece(to, pp);
      this.counts[piece]--;
      this.counts[pp]++;
    } else {
      this.putPiece(to, piece);
    }

    const pt = pieceType(piece);
    if (pt === KING) {
      this.kingSq[us] = to;
      if (flags & FLAG_CASTLE) {
        // Déplacement de la tour.
        let rFrom: number;
        let rTo: number;
        if (to === from + 2) {
          rFrom = from + 3;
          rTo = from + 1;
        } else {
          rFrom = from - 4;
          rTo = from - 1;
        }
        const rook = b[rFrom];
        this.removePiece(rFrom);
        this.putPiece(rTo, rook);
      }
    }

    this.hashLo ^= Z_CASTLE_LO[this.castling];
    this.hashHi ^= Z_CASTLE_HI[this.castling];
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.hashLo ^= Z_CASTLE_LO[this.castling];
    this.hashHi ^= Z_CASTLE_HI[this.castling];

    if (flags & FLAG_DOUBLE) {
      // La case e.p. n'est retenue que si un pion adverse est en mesure de capturer.
      const epSq = (from + to) >> 1;
      const enemyPawn = makePiece(them, PAWN);
      const l = to - 1;
      const r = to + 1;
      if ((!(l & 0x88) && b[l] === enemyPawn) || (!(r & 0x88) && b[r] === enemyPawn)) {
        this.ep = epSq;
        this.hashLo ^= Z_EP_LO[epSq & 7];
        this.hashHi ^= Z_EP_HI[epSq & 7];
      }
    }

    if (pt === PAWN || captured !== EMPTY) this.halfmove = 0;
    else this.halfmove++;
    if (us === BLACK) this.fullmove++;

    this.side = them;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.ply = ply + 1;
    this.histLo[this.ply] = this.hashLo;
    this.histHi[this.ply] = this.hashHi;

    if (this.isAttacked(this.kingSq[us], them)) {
      this.unmakeMove();
      return false;
    }
    return true;
  }

  unmakeMove(): void {
    const ply = this.ply - 1;
    const m = this.uMove[ply];
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const promo = movePromo(m);
    const b = this.board;
    const them = this.side;
    const us = (them ^ 1) as Color;

    // Retour arrière simple : le hachage est restauré depuis l'historique.
    let piece = b[to];
    if (promo) {
      this.counts[piece]--;
      piece = makePiece(us, PAWN);
      this.counts[piece]++;
    }
    b[from] = piece;
    b[to] = EMPTY;
    const captured = this.uCaptured[ply];
    if (captured !== EMPTY) {
      if (flags & FLAG_EP) {
        b[us === WHITE ? to - 16 : to + 16] = captured;
      } else {
        b[to] = captured;
      }
      this.counts[captured]++;
    }
    if (pieceType(piece) === KING) {
      this.kingSq[us] = from;
      if (flags & FLAG_CASTLE) {
        if (to === from + 2) {
          b[from + 3] = b[from + 1];
          b[from + 1] = EMPTY;
        } else {
          b[from - 4] = b[from - 1];
          b[from - 1] = EMPTY;
        }
      }
    }
    this.castling = this.uCastling[ply];
    this.ep = this.uEp[ply];
    this.halfmove = this.uHalfmove[ply];
    if (us === BLACK) this.fullmove--;
    this.side = us;
    this.ply = ply;
    this.hashLo = this.histLo[ply];
    this.hashHi = this.histHi[ply];
  }

  /** Coup nul (passer son tour), utilisé par le null-move pruning. */
  makeNullMove(): void {
    const ply = this.ply;
    this.uMove[ply] = 0;
    this.uCastling[ply] = this.castling;
    this.uEp[ply] = this.ep;
    this.uHalfmove[ply] = this.halfmove;
    this.uCaptured[ply] = EMPTY;
    if (this.ep >= 0) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
    this.ep = -1;
    // halfmove remis à 0 : la détection de répétition ne traverse pas un coup nul.
    this.halfmove = 0;
    this.side = (this.side ^ 1) as Color;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.ply = ply + 1;
    this.histLo[this.ply] = this.hashLo;
    this.histHi[this.ply] = this.hashHi;
  }

  unmakeNullMove(): void {
    const ply = this.ply - 1;
    this.ep = this.uEp[ply];
    this.halfmove = this.uHalfmove[ply];
    this.side = (this.side ^ 1) as Color;
    this.ply = ply;
    this.hashLo = this.histLo[ply];
    this.hashHi = this.histHi[ply];
  }

  /** Liste des coups légaux (allocation : à réserver à l'interface et aux tests). */
  legalMoves(): number[] {
    const buf = new Int32Array(320);
    const n = this.generateMoves(buf, 0);
    const res: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.makeMove(buf[i])) {
        this.unmakeMove();
        res.push(buf[i]);
      }
    }
    return res;
  }

  hasLegalMove(): boolean {
    const buf = new Int32Array(320);
    const n = this.generateMoves(buf, 0);
    for (let i = 0; i < n; i++) {
      if (this.makeMove(buf[i])) {
        this.unmakeMove();
        return true;
      }
    }
    return false;
  }

  /**
   * Nombre d'occurrences antérieures de la position courante
   * (en ne remontant que jusqu'au dernier coup irréversible).
   */
  repetitionCount(): number {
    let count = 0;
    const lo = this.hashLo;
    const hi = this.hashHi;
    const limit = Math.max(0, this.ply - this.halfmove);
    for (let i = this.ply - 2; i >= limit; i -= 2) {
      if (this.histLo[i] === lo && this.histHi[i] === hi) count++;
    }
    return count;
  }

  /** Coups joués depuis la position chargée (dans l'ordre). */
  moveHistory(): number[] {
    return Array.from(this.uMove.subarray(0, this.ply));
  }

  /** Coup joué au demi-coup i (0 = premier). */
  moveAt(i: number): number {
    return this.uMove[i];
  }

  /**
   * Matériel insuffisant pour mater (cas FIDE de position morte usuels) :
   * R/R, R+C/R, R+F/R, et tous les fous sur des cases de même couleur sans autre matériel.
   */
  isInsufficientMaterial(): boolean {
    const c = this.counts;
    if (c[PAWN] || c[PAWN | 8] || c[ROOK] || c[ROOK | 8] || c[QUEEN] || c[QUEEN | 8]) return false;
    const wn = c[KNIGHT];
    const bn = c[KNIGHT | 8];
    const wb = c[BISHOP];
    const bb = c[BISHOP | 8];
    const minors = wn + bn + wb + bb;
    if (minors <= 1) return true;
    if (wn + bn > 0) return false;
    // Uniquement des fous : nul si tous sur la même couleur de case.
    let light = 0;
    let dark = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      if (pieceType(this.board[sq]) === BISHOP) {
        if (((sq >> 4) + (sq & 7)) & 1) light++;
        else dark++;
      }
    }
    return light === 0 || dark === 0;
  }
}
