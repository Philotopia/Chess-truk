import { parseFen, toFen } from './fen';
import { moveToSan, moveToUci, sanToMove, uciToMove } from './notation';
import { Position } from './position';
import { START_FEN, WHITE } from './types';

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type TerminationReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-moves'
  | 'insufficient-material'
  | 'max-moves'
  | 'adjudication'
  | 'resign'
  | 'error'
  | 'aborted'
  | 'none';

export interface GameStatus {
  over: boolean;
  result: GameResult;
  reason: TerminationReason;
  inCheck: boolean;
}

export const REASON_FR: Record<TerminationReason, string> = {
  checkmate: 'échec et mat',
  stalemate: 'pat',
  threefold: 'triple répétition',
  'fifty-moves': 'règle des 50 coups',
  'insufficient-material': 'matériel insuffisant',
  'max-moves': 'limite de coups atteinte',
  adjudication: 'adjudication',
  resign: 'abandon',
  error: 'erreur',
  aborted: 'interrompue',
  none: '',
};

/** Statut de la position selon les règles FIDE (le mat prime sur la règle des 50 coups). */
export function gameStatus(pos: Position): GameStatus {
  const inCheck = pos.inCheck();
  const hasMove = pos.hasLegalMove();
  if (!hasMove) {
    if (inCheck) return { over: true, result: pos.side === WHITE ? '0-1' : '1-0', reason: 'checkmate', inCheck };
    return { over: true, result: '1/2-1/2', reason: 'stalemate', inCheck };
  }
  if (pos.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient-material', inCheck };
  if (pos.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-moves', inCheck };
  if (pos.repetitionCount() >= 2) return { over: true, result: '1/2-1/2', reason: 'threefold', inCheck };
  return { over: false, result: '*', reason: 'none', inCheck };
}

export interface GameMove {
  move: number;
  uci: string;
  san: string;
  fenAfter: string;
}

/** Partie : position de départ + suite de coups, avec SAN et FEN mémorisées. */
export class Game {
  readonly startFen: string;
  pos: Position;
  moves: GameMove[] = [];

  constructor(startFen: string = START_FEN) {
    this.pos = parseFen(startFen);
    this.startFen = toFen(this.pos);
  }

  get fen(): string {
    return toFen(this.pos);
  }

  status(): GameStatus {
    return gameStatus(this.pos);
  }

  play(m: number): GameMove {
    const san = moveToSan(this.pos, m);
    if (!this.pos.makeMove(m)) throw new Error('Coup illégal : ' + moveToUci(m));
    const gm: GameMove = { move: m, uci: moveToUci(m), san, fenAfter: toFen(this.pos) };
    this.moves.push(gm);
    return gm;
  }

  playUci(uci: string): GameMove {
    const m = uciToMove(this.pos, uci);
    if (m === null) throw new Error(`Coup UCI illégal « ${uci} » dans ${this.fen}`);
    return this.play(m);
  }

  playSan(san: string): GameMove {
    const m = sanToMove(this.pos, san);
    if (m === null) throw new Error(`Coup SAN illégal ou ambigu « ${san} » dans ${this.fen}`);
    return this.play(m);
  }

  undo(): GameMove | undefined {
    const gm = this.moves.pop();
    if (gm) this.pos.unmakeMove();
    return gm;
  }

  /** FEN après n demi-coups (0 = départ). */
  fenAt(n: number): string {
    return n === 0 ? this.startFen : this.moves[n - 1].fenAfter;
  }

  uciMoves(): string[] {
    return this.moves.map((m) => m.uci);
  }

  clone(): Game {
    const g = new Game(this.startFen);
    for (const m of this.moves) g.playUci(m.uci);
    return g;
  }

  static fromUci(startFen: string, uciMoves: string[]): Game {
    const g = new Game(startFen);
    for (const u of uciMoves) g.playUci(u);
    return g;
  }
}
