// Recherche : Negamax + alpha-bêta, approfondissement itératif, table de transposition,
// tri des coups, quiescence, et optimisations activables séparément (killers, historique,
// PVS, fenêtres d'aspiration, null move, LMR, extension d'échec).
// Le moteur choisit ses coups seul : aucune dépendance à Stockfish.

import { moveToUci } from '../core/notation';
import { MAX_HISTORY, type Position } from '../core/position';
import {
  BISHOP,
  FLAG_CAPTURE,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
} from '../core/types';
import { evaluateStm } from './evaluate';
import type { EvalParams, SearchOptions } from './params';
import { TT_EXACT, TT_LOWER, TT_UPPER, TranspositionTable } from './tt';

export const INF = 32500;
export const MATE = 32000;
export const MAX_PLY = 128;
/** Au-delà de ce seuil, un score représente un mat. */
export const MATE_BOUND = MATE - MAX_PLY;

const MOVE_STRIDE = 320;

export interface SearchLimits {
  depth?: number;
  nodes?: number;
  timeMs?: number;
}

export interface SearchInfo {
  depth: number;
  seldepth: number;
  /** Score du point de vue du camp au trait. */
  score: number;
  /** Mat en N coups (positif : on mate, négatif : on est maté), sinon null. */
  mate: number | null;
  nodes: number;
  timeMs: number;
  nps: number;
  pv: string[];
  hashfull: number;
}

export interface SearchResult extends SearchInfo {
  bestMove: string | null;
  /** Profondeur entièrement terminée. */
  completedDepth: number;
  stopped: boolean;
  ttSizeMB: number;
  ttHits: number;
  ttProbes: number;
  /** Nœuds de quiescence (inclus dans nodes). */
  qnodes: number;
}

export function mateIn(score: number): number | null {
  if (score >= MATE_BOUND) return Math.ceil((MATE - score) / 2);
  if (score <= -MATE_BOUND) return -Math.ceil((MATE + score) / 2);
  return null;
}

function scoreToTT(score: number, ply: number): number {
  if (score >= MATE_BOUND) return score + ply;
  if (score <= -MATE_BOUND) return score - ply;
  return score;
}
function scoreFromTT(score: number, ply: number): number {
  if (score >= MATE_BOUND) return score - ply;
  if (score <= -MATE_BOUND) return score + ply;
  return score;
}

// Valeurs MVV-LVA par type de pièce.
const ORDER_VALUE = [0, 1, 3, 3, 5, 9, 20];

const SCORE_TT = 10_000_000;
const SCORE_CAPTURE = 1_000_000;
const SCORE_PROMO = 900_000;
const SCORE_KILLER1 = 800_000;
const SCORE_KILLER2 = 700_000;
const HISTORY_MAX = 600_000;

export class Searcher {
  tt: TranspositionTable;
  params: EvalParams;
  opts: SearchOptions;

  private moves = new Int32Array(MAX_PLY * MOVE_STRIDE);
  private scores = new Int32Array(MAX_PLY * MOVE_STRIDE);
  private pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private pvLength = new Int32Array(MAX_PLY + 1);
  private killers = new Int32Array(MAX_PLY * 2);
  private history = new Int32Array(2 * 128 * 128);

  private pos!: Position;
  private nodes = 0;
  private qnodes = 0;
  private seldepth = 0;
  private startTime = 0;
  private maxNodes = Infinity;
  private maxTime = Infinity;
  private stopped = false;
  private canStop = false;
  private rootBestMove = 0;
  private iterBestMove = 0;
  private iterBestScore = 0;
  private iterPv: number[] = [];

  constructor(params: EvalParams, opts: SearchOptions) {
    this.params = params;
    this.opts = opts;
    this.tt = new TranspositionTable(opts.useTT ? opts.ttSizeMB : 1);
  }

  /** Réinitialise l'état entre deux parties (table de transposition, historique). */
  newGame(): void {
    this.tt.clear();
    this.history.fill(0);
    this.killers.fill(0);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private checkStop(): void {
    if (!this.canStop) return;
    if (this.nodes >= this.maxNodes) {
      this.stopped = true;
    } else if ((this.nodes & 1023) === 0 && this.maxTime !== Infinity && this.now() - this.startTime >= this.maxTime) {
      this.stopped = true;
    }
  }

  /**
   * Lance une recherche sur `pos` (la position est restaurée à la fin).
   * L'historique de `pos` sert à détecter les répétitions avec la partie.
   */
  search(pos: Position, limits: SearchLimits, onInfo?: (info: SearchInfo) => void): SearchResult {
    this.pos = pos;
    this.nodes = 0;
    this.qnodes = 0;
    this.seldepth = 0;
    this.stopped = false;
    this.canStop = false;
    this.startTime = this.now();
    this.maxNodes = limits.nodes && limits.nodes > 0 ? limits.nodes : Infinity;
    this.maxTime = limits.timeMs && limits.timeMs > 0 ? limits.timeMs : Infinity;
    const maxDepth = Math.min(limits.depth && limits.depth > 0 ? limits.depth : MAX_PLY - 8, MAX_PLY - 8);
    this.killers.fill(0);
    // Vieillissement de l'historique entre deux coups.
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
    this.tt.newSearch();
    const ttProbes0 = this.tt.probes;
    const ttHits0 = this.tt.hits;
    if (pos.ply > MAX_HISTORY - MAX_PLY - 2) throw new Error('Historique de partie trop long pour la recherche.');

    const rootMoves = pos.legalMoves();
    let last: SearchInfo = {
      depth: 0,
      seldepth: 0,
      score: 0,
      mate: null,
      nodes: 0,
      timeMs: 0,
      nps: 0,
      pv: [],
      hashfull: 0,
    };
    this.rootBestMove = rootMoves.length ? rootMoves[0] : 0;
    let completedDepth = 0;
    let bestPv: number[] = this.rootBestMove ? [this.rootBestMove] : [];

    if (rootMoves.length === 0) {
      const score = pos.inCheck() ? -MATE : 0;
      return {
        ...last,
        score,
        mate: pos.inCheck() ? 0 : null,
        bestMove: null,
        completedDepth: 0,
        stopped: false,
        ttSizeMB: this.tt.sizeMB,
        ttHits: 0,
        ttProbes: 0,
        qnodes: 0,
      };
    }

    let prevScore = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      // La profondeur 1 est toujours terminée pour garantir un coup.
      this.canStop = depth > 1;
      this.iterBestMove = 0;
      this.iterPv = [];
      let score: number;
      if (this.opts.aspiration && depth >= 4 && Math.abs(prevScore) < MATE_BOUND) {
        let delta = this.opts.aspirationWindow;
        let alpha = Math.max(-INF, prevScore - delta);
        let beta = Math.min(INF, prevScore + delta);
        for (;;) {
          score = this.negamax(depth, alpha, beta, 0, true);
          if (this.stopped) break;
          if (score <= alpha) {
            alpha = Math.max(-INF, alpha - delta);
            delta *= 2;
          } else if (score >= beta) {
            beta = Math.min(INF, beta + delta);
            delta *= 2;
          } else break;
          if (delta > 1000) {
            alpha = -INF;
            beta = INF;
          }
        }
      } else {
        score = this.negamax(depth, -INF, INF, 0, true);
      }

      if (this.stopped) {
        // Itération partielle : on ne retient que les coups racine entièrement évalués au-dessus d'alpha.
        if (this.iterBestMove !== 0) {
          this.rootBestMove = this.iterBestMove;
          bestPv = this.iterPv.length ? this.iterPv : [this.iterBestMove];
          last = this.makeInfo(Math.max(1, depth - 1), this.iterBestScore, bestPv);
        }
        break;
      }
      completedDepth = depth;
      prevScore = score;
      const pvLen = this.pvLength[0];
      bestPv = [];
      for (let i = 0; i < pvLen; i++) bestPv.push(this.pvTable[i]);
      if (bestPv.length === 0 && this.iterBestMove) bestPv = [this.iterBestMove];
      if (bestPv.length) this.rootBestMove = bestPv[0];
      last = this.makeInfo(depth, score, bestPv);
      onInfo?.(last);
      // Mat trouvé et confirmé : inutile d'aller plus loin.
      if (Math.abs(score) >= MATE_BOUND && depth >= 2 * (MATE - Math.abs(score)) + 2) break;
      if (this.maxTime !== Infinity && this.now() - this.startTime > this.maxTime * 0.6) break;
    }

    const timeMs = this.now() - this.startTime;
    return {
      ...last,
      nodes: this.nodes,
      timeMs,
      nps: timeMs > 0 ? Math.round((this.nodes * 1000) / timeMs) : 0,
      bestMove: this.rootBestMove ? moveToUci(this.rootBestMove) : null,
      completedDepth,
      stopped: this.stopped,
      ttSizeMB: this.tt.sizeMB,
      ttHits: this.tt.hits - ttHits0,
      ttProbes: this.tt.probes - ttProbes0,
      qnodes: this.qnodes,
      hashfull: this.tt.hashfull(),
    };
  }

  private makeInfo(depth: number, scoreIn: number, pv: number[]): SearchInfo {
    const score = scoreIn || 0; // normalise -0
    const timeMs = this.now() - this.startTime;
    return {
      depth,
      seldepth: this.seldepth,
      score,
      mate: mateIn(score),
      nodes: this.nodes,
      timeMs,
      nps: timeMs > 0 ? Math.round((this.nodes * 1000) / timeMs) : 0,
      pv: pv.map(moveToUci),
      hashfull: this.tt.hashfull(),
    };
  }

  private isDraw(): boolean {
    const pos = this.pos;
    if (pos.halfmove >= 100) return true;
    if (pos.isInsufficientMaterial()) return true;
    // Toute répétition dans la ligne ou avec la partie est considérée nulle.
    return pos.repetitionCount() > 0;
  }

  private hasNonPawnMaterial(side: number): boolean {
    const c = this.pos.counts;
    const o = side << 3;
    return c[KNIGHT | o] + c[BISHOP | o] + c[ROOK | o] + c[QUEEN | o] > 0;
  }

  private scoreMoves(start: number, end: number, ttMove: number, ply: number): void {
    const b = this.pos.board;
    const side = this.pos.side;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const useKillers = this.opts.killers;
    const useHistory = this.opts.history;
    const mvv = this.opts.mvvLva;
    for (let i = start; i < end; i++) {
      const m = this.moves[i];
      let s = 0;
      if (m === ttMove) s = SCORE_TT;
      else if (moveFlags(m) & FLAG_CAPTURE) {
        if (mvv) {
          const victim = b[moveTo(m)] & 7 || PAWN; // en passant : case vide
          const attacker = b[moveFrom(m)] & 7;
          s = SCORE_CAPTURE + ORDER_VALUE[victim] * 100 - ORDER_VALUE[attacker];
        } else s = SCORE_CAPTURE;
        if (movePromo(m)) s += ORDER_VALUE[movePromo(m)];
      } else if (movePromo(m)) {
        s = SCORE_PROMO + ORDER_VALUE[movePromo(m)];
      } else if (useKillers && m === k1) s = SCORE_KILLER1;
      else if (useKillers && m === k2) s = SCORE_KILLER2;
      else if (useHistory) s = this.history[side * 16384 + moveFrom(m) * 128 + moveTo(m)];
      this.scores[i] = s;
    }
  }

  /** Sélection du meilleur coup restant (tri partiel, sans allocation). */
  private pickMove(i: number, end: number): number {
    let best = i;
    let bs = this.scores[i];
    for (let j = i + 1; j < end; j++) {
      if (this.scores[j] > bs) {
        bs = this.scores[j];
        best = j;
      }
    }
    if (best !== i) {
      const m = this.moves[i];
      this.moves[i] = this.moves[best];
      this.moves[best] = m;
      const s = this.scores[i];
      this.scores[i] = this.scores[best];
      this.scores[best] = s;
    }
    return this.moves[i];
  }

  private updatePv(ply: number, m: number): void {
    const base = ply * MAX_PLY;
    const child = (ply + 1) * MAX_PLY;
    this.pvTable[base + ply] = m;
    const len = this.pvLength[ply + 1];
    for (let j = ply + 1; j < len; j++) this.pvTable[base + j] = this.pvTable[child + j];
    this.pvLength[ply] = len > ply + 1 ? len : ply + 1;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    const pos = this.pos;
    this.pvLength[ply] = ply;
    if (ply > this.seldepth) this.seldepth = ply;
    const isRoot = ply === 0;

    if (!isRoot) {
      this.checkStop();
      if (this.stopped) return 0;
      if (this.isDraw()) return 0;
      // Élagage par distance au mat.
      const ma = -MATE + ply;
      const mb = MATE - ply - 1;
      if (alpha < ma) alpha = ma;
      if (beta > mb) beta = mb;
      if (alpha >= beta) return alpha;
    }

    const inCheck = pos.inCheck();
    if (inCheck && this.opts.checkExtension && !isRoot) depth++;

    if (depth <= 0) {
      return this.opts.quiescence ? this.qsearch(alpha, beta, ply) : this.leafEval(ply);
    }
    this.nodes++;
    if (ply >= MAX_PLY - 2) return evaluateStm(pos, this.params);

    const isPv = beta - alpha > 1;
    let ttMove = 0;
    if (this.opts.useTT && this.tt.probe(pos.hashLo, pos.hashHi)) {
      ttMove = this.tt.hitMove;
      if (!isPv && this.tt.hitDepth >= depth) {
        const s = scoreFromTT(this.tt.hitScore, ply);
        const f = this.tt.hitFlag;
        if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
      }
    }

    // Null move pruning : si passer son tour suffit à dépasser beta, la position est trop bonne.
    if (
      this.opts.nullMove &&
      allowNull &&
      !inCheck &&
      !isPv &&
      depth >= 3 &&
      this.hasNonPawnMaterial(pos.side) &&
      evaluateStm(pos, this.params) >= beta
    ) {
      const R = depth > 6 ? 3 : 2;
      pos.makeNullMove();
      const s = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      pos.unmakeNullMove();
      if (this.stopped) return 0;
      if (s >= beta) return s >= MATE_BOUND ? beta : s;
    }

    const start = ply * MOVE_STRIDE;
    const end = pos.generateMoves(this.moves, start);
    this.scoreMoves(start, end, ttMove, ply);

    const origAlpha = alpha;
    let bestScore = -INF;
    let bestMove = 0;
    let legal = 0;
    for (let i = start; i < end; i++) {
      const m = this.pickMove(i, end);
      if (!pos.makeMove(m)) continue;
      legal++;
      const quiet = (moveFlags(m) & FLAG_CAPTURE) === 0 && movePromo(m) === 0;
      let score: number;
      const newDepth = depth - 1;
      if (legal === 1) {
        score = -this.negamax(newDepth, -beta, -alpha, ply + 1, true);
      } else {
        let reduction = 0;
        if (
          this.opts.lmr &&
          depth >= 3 &&
          legal > 3 &&
          quiet &&
          !inCheck &&
          !pos.inCheck() &&
          m !== this.killers[ply * 2] &&
          m !== this.killers[ply * 2 + 1]
        ) {
          reduction = legal > 6 && depth >= 5 ? 2 : 1;
          if (isPv && reduction > 1) reduction = 1;
        }
        if (this.opts.pvs) {
          score = -this.negamax(newDepth - reduction, -alpha - 1, -alpha, ply + 1, true);
          if (score > alpha && reduction > 0 && !this.stopped) {
            score = -this.negamax(newDepth, -alpha - 1, -alpha, ply + 1, true);
          }
          if (score > alpha && score < beta && !this.stopped) {
            score = -this.negamax(newDepth, -beta, -alpha, ply + 1, true);
          }
        } else {
          score = -this.negamax(newDepth - reduction, -beta, -alpha, ply + 1, true);
          if (score > alpha && reduction > 0 && !this.stopped) {
            score = -this.negamax(newDepth, -beta, -alpha, ply + 1, true);
          }
        }
      }
      pos.unmakeMove();
      if (this.stopped) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          this.updatePv(ply, m);
          if (isRoot) {
            this.iterBestMove = m;
            this.iterBestScore = score;
            const pv: number[] = [];
            for (let j = 0; j < this.pvLength[0]; j++) pv.push(this.pvTable[j]);
            this.iterPv = pv;
          }
          if (score >= beta) {
            if (quiet) {
              if (this.opts.killers && this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              if (this.opts.history) {
                const hi = pos.side * 16384 + moveFrom(m) * 128 + moveTo(m);
                this.history[hi] += depth * depth;
                if (this.history[hi] > HISTORY_MAX) for (let k = 0; k < this.history.length; k++) this.history[k] >>= 1;
              }
            }
            break;
          }
        }
      }
    }

    if (legal === 0) return inCheck ? -MATE + ply : 0;

    if (this.opts.useTT) {
      const flag = bestScore >= beta ? TT_LOWER : bestScore > origAlpha ? TT_EXACT : TT_UPPER;
      this.tt.store(pos.hashLo, pos.hashHi, depth, flag, scoreToTT(bestScore, ply), bestMove);
    }
    return bestScore;
  }

  /** Feuille sans quiescence : évaluation statique, mais détection des mats et pats. */
  private leafEval(ply: number): number {
    this.nodes++;
    const pos = this.pos;
    if (!pos.hasLegalMove()) return pos.inCheck() ? -MATE + ply : 0;
    return evaluateStm(pos, this.params);
  }

  private qsearch(alpha: number, beta: number, ply: number): number {
    const pos = this.pos;
    this.nodes++;
    this.qnodes++;
    this.pvLength[ply] = ply;
    if (ply > this.seldepth) this.seldepth = ply;
    this.checkStop();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluateStm(pos, this.params);
    if (pos.isInsufficientMaterial()) return 0;

    const inCheck = pos.inCheck();
    let bestScore = -INF;
    if (!inCheck) {
      const stand = evaluateStm(pos, this.params);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      bestScore = stand;
    }
    const start = ply * MOVE_STRIDE;
    // En échec : toutes les parades (permet de détecter les mats dans la quiescence).
    const end = pos.generateMoves(this.moves, start, !inCheck);
    this.scoreMoves(start, end, 0, ply);
    let legal = 0;
    for (let i = start; i < end; i++) {
      const m = this.pickMove(i, end);
      // Hors échec, les sous-promotions sans capture sont ignorées.
      if (!inCheck && movePromo(m) && movePromo(m) !== QUEEN && !(moveFlags(m) & FLAG_CAPTURE)) continue;
      if (!pos.makeMove(m)) continue;
      legal++;
      const score = -this.qsearch(-beta, -alpha, ply + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > bestScore) {
        bestScore = score;
        if (score > alpha) {
          alpha = score;
          this.updatePv(ply, m);
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return bestScore;
  }
}

/** Score affichable (ex. « +0.47 », « #3 », « -#2 ») à partir d'un score côté trait. */
export function formatScore(score: number, whitePov = false, sideToMove = WHITE): string {
  const s = whitePov && sideToMove !== WHITE ? -score : score;
  const m = mateIn(s);
  if (m !== null) return m >= 0 ? `#${m}` : `-#${-m}`;
  return (s >= 0 ? '+' : '') + (s / 100).toFixed(2);
}

