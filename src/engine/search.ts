// Recherche : Negamax + alpha-bêta, approfondissement itératif, table de transposition,
// tri des coups, quiescence, et optimisations activables séparément (killers, historique,
// contre-coup, PVS, fenêtres d'aspiration, null move, LMR, extension d'échec, reverse futility,
// futility, late move pruning, razoring, SEE, TT en quiescence, IIR).
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
import { SEE_VALUE, see } from './see';
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
const SCORE_COUNTER = 650_000;
/** Captures perdantes (SEE < 0) : après les coups calmes. */
const SCORE_BAD_CAPTURE = -1_000_000;
const HISTORY_MAX = 600_000;
/** Plafond de l'historique (formule « gravité » : bonus − h·|bonus|/HIST_GRAVITY). */
const HIST_GRAVITY = 16384;

// Table de réductions LMR logarithmiques.
const LMR = new Int8Array(64 * 64);
for (let d = 1; d < 64; d++) {
  for (let m = 1; m < 64; m++) LMR[d * 64 + m] = Math.floor(0.75 + (Math.log(d) * Math.log(m)) / 2.25);
}
const LMP_COUNT = [0, 5, 8, 13, 20, 29, 40];
const FUTILITY_MARGIN = [0, 120, 220, 320, 420];
const RFP_MARGIN = 80;

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
  private counter = new Int32Array(16 * 128);
  private evalStack = new Int32Array(MAX_PLY + 2);
  private quietsTried = new Int32Array(MAX_PLY * 64);
  // Cache d'évaluation statique (clé 64 bits) : évite de réévaluer les positions revues d'une itération à l'autre.
  private static readonly EVAL_CACHE_BITS = 18;
  private evalKeyLo = new Int32Array(1 << Searcher.EVAL_CACHE_BITS);
  private evalKeyHi = new Int32Array(1 << Searcher.EVAL_CACHE_BITS);
  private evalVal = new Int32Array(1 << Searcher.EVAL_CACHE_BITS);
  private evalUsed = new Uint8Array(1 << Searcher.EVAL_CACHE_BITS);
  private evalParamsRef: EvalParams | null = null;
  evalHits = 0;
  evalCalls = 0;

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
    this.counter.fill(0);
    this.evalUsed.fill(0);
  }

  /** Évaluation statique (camp au trait), via le cache. */
  private evalStm(): number {
    const pos = this.pos;
    if (this.evalParamsRef !== this.params) {
      this.evalUsed.fill(0);
      this.evalParamsRef = this.params;
    }
    this.evalCalls++;
    const i = pos.hashLo & ((1 << Searcher.EVAL_CACHE_BITS) - 1);
    if (this.evalUsed[i] && this.evalKeyLo[i] === pos.hashLo && this.evalKeyHi[i] === pos.hashHi) {
      this.evalHits++;
      return this.evalVal[i];
    }
    const v = evaluateStm(pos, this.params);
    this.evalUsed[i] = 1;
    this.evalKeyLo[i] = pos.hashLo;
    this.evalKeyHi[i] = pos.hashHi;
    this.evalVal[i] = v;
    return v;
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
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= this.opts.lmrLog ? 1 : 2;
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

  private historyIndex(side: number, m: number): number {
    return side * 16384 + moveFrom(m) * 128 + moveTo(m);
  }

  private counterIndex(): number {
    const pos = this.pos;
    if (pos.ply === 0) return -1;
    const prev = pos.moveAt(pos.ply - 1);
    if (prev === 0) return -1;
    return (pos.board[moveTo(prev)] & 15) * 128 + moveTo(prev);
  }

  private scoreMoves(start: number, end: number, ttMove: number, ply: number): void {
    const b = this.pos.board;
    const side = this.pos.side;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const useKillers = this.opts.killers;
    const useHistory = this.opts.history;
    const mvv = this.opts.mvvLva;
    const useSee = this.opts.see;
    const ci = this.opts.countermove ? this.counterIndex() : -1;
    const cm = ci >= 0 ? this.counter[ci] : 0;
    for (let i = start; i < end; i++) {
      const m = this.moves[i];
      let s = 0;
      if (m === ttMove) s = SCORE_TT;
      else if (moveFlags(m) & FLAG_CAPTURE) {
        if (mvv) {
          const victim = b[moveTo(m)] & 7 || PAWN; // en passant : case vide
          const attacker = b[moveFrom(m)] & 7;
          s = SCORE_CAPTURE + ORDER_VALUE[victim] * 100 - ORDER_VALUE[attacker];
          // Capture d'une pièce de valeur ≤ par une pièce plus chère : vérifier par SEE.
          if (useSee && ORDER_VALUE[attacker] > ORDER_VALUE[victim] && see(this.pos, m) < 0) s += SCORE_BAD_CAPTURE - SCORE_CAPTURE;
        } else s = SCORE_CAPTURE;
        if (movePromo(m)) s += ORDER_VALUE[movePromo(m)];
      } else if (movePromo(m)) {
        s = movePromo(m) === QUEEN ? SCORE_PROMO + ORDER_VALUE[QUEEN] : SCORE_BAD_CAPTURE;
      } else if (useKillers && m === k1) s = SCORE_KILLER1;
      else if (useKillers && m === k2) s = SCORE_KILLER2;
      else if (m === cm && cm !== 0) s = SCORE_COUNTER;
      else if (useHistory) s = this.history[this.historyIndex(side, m)];
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

  /** Mise à jour de l'historique (formule « gravité », bornée). */
  private updateHistory(idx: number, bonus: number): void {
    if (this.opts.lmrLog) {
      const h = this.history[idx];
      this.history[idx] = h + bonus - Math.trunc((h * Math.abs(bonus)) / HIST_GRAVITY);
    } else {
      this.history[idx] += bonus;
      if (this.history[idx] > HISTORY_MAX) for (let k = 0; k < this.history.length; k++) this.history[k] >>= 1;
    }
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    const pos = this.pos;
    const o = this.opts;
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
    if (inCheck && o.checkExtension && !isRoot) depth++;

    if (depth <= 0) {
      return o.quiescence ? this.qsearch(alpha, beta, ply) : this.leafEval(ply);
    }
    this.nodes++;
    if (ply >= MAX_PLY - 2) return this.evalStm();

    const isPv = beta - alpha > 1;
    let ttMove = 0;
    if (o.useTT && this.tt.probe(pos.hashLo, pos.hashHi)) {
      ttMove = this.tt.hitMove;
      if (!isPv && this.tt.hitDepth >= depth) {
        const s = scoreFromTT(this.tt.hitScore, ply);
        const f = this.tt.hitFlag;
        if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
      }
    }

    // Évaluation statique (utilisée par les élagages) et tendance « improving ».
    const needEval = !inCheck && (o.rfp || o.futility || o.razoring || o.nullMove || o.lmp || o.lmrLog);
    const staticEval = needEval ? this.evalStm() : -INF;
    this.evalStack[ply] = inCheck ? -INF : staticEval;
    const improving = !inCheck && ply >= 2 && this.evalStack[ply - 2] !== -INF && staticEval > this.evalStack[ply - 2];

    if (!isPv && !inCheck && !isRoot) {
      // Reverse futility pruning.
      if (o.rfp && depth <= 7 && Math.abs(beta) < MATE_BOUND && staticEval - RFP_MARGIN * (depth - (improving ? 1 : 0)) >= beta) {
        return staticEval;
      }
      // Razoring.
      if (o.razoring && depth <= 2 && staticEval + 300 * depth < alpha) {
        const v = this.qsearch(alpha, alpha + 1, ply);
        if (this.stopped) return 0;
        if (v <= alpha) return v;
      }
      // Null move pruning : si passer son tour suffit à dépasser bêta, la position est trop bonne.
      if (o.nullMove && allowNull && depth >= 3 && staticEval >= beta && this.hasNonPawnMaterial(pos.side)) {
        const R = o.nullMoveAdaptive ? 3 + Math.floor(depth / 4) + Math.min(3, Math.floor((staticEval - beta) / 200)) : depth > 6 ? 3 : 2;
        pos.makeNullMove();
        const s = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNullMove();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    // Internal iterative reduction : sans coup de table, on réduit (la branche est probablement peu importante).
    if (o.iir && depth >= 4 && ttMove === 0 && !inCheck) depth--;

    const start = ply * MOVE_STRIDE;
    const end = pos.generateMoves(this.moves, start);
    this.scoreMoves(start, end, ttMove, ply);

    const futile =
      o.futility && !isPv && !inCheck && depth <= 4 && Math.abs(alpha) < MATE_BOUND && staticEval + FUTILITY_MARGIN[depth] <= alpha;
    const lmpLimit = o.lmp && !isPv && !inCheck && depth <= 6 ? (improving ? LMP_COUNT[depth] : LMP_COUNT[depth] >> 1) + 1 : 1 << 30;

    const origAlpha = alpha;
    let bestScore = -INF;
    let bestMove = 0;
    let legal = 0;
    let quietCount = 0;
    const qBase = ply * 64;
    for (let i = start; i < end; i++) {
      const m = this.pickMove(i, end);
      const isCap = (moveFlags(m) & FLAG_CAPTURE) !== 0;
      const quiet = !isCap && movePromo(m) === 0;
      const isKiller = m === this.killers[ply * 2] || m === this.killers[ply * 2 + 1];

      // SEE : captures nettement perdantes ignorées à faible profondeur.
      if (o.see && !isPv && !inCheck && legal > 0 && depth <= 4 && isCap && bestScore > -MATE_BOUND && this.scores[i] < 0) {
        if (see(pos, m) < -100 * depth) continue;
      }
      // Late move pruning (avant de jouer le coup : on ne connaît pas encore l'échec ; les coups calmes tardifs sont rarement des échecs utiles).
      if (quiet && legal > 0 && quietCount >= lmpLimit && bestScore > -MATE_BOUND && !isKiller) continue;

      if (!pos.makeMove(m)) continue;
      const givesCheck = pos.inCheck();
      // Futility pruning : un coup calme ne remontera pas l'éval au-dessus d'alpha.
      if (futile && quiet && !givesCheck && legal > 0 && bestScore > -MATE_BOUND) {
        pos.unmakeMove();
        quietCount++;
        continue;
      }
      legal++;
      if (quiet && quietCount < 64) this.quietsTried[qBase + quietCount] = m;
      if (quiet) quietCount++;

      let score: number;
      const newDepth = depth - 1;
      if (legal === 1) {
        score = -this.negamax(newDepth, -beta, -alpha, ply + 1, true);
      } else {
        let reduction = 0;
        if (o.lmr && depth >= 3 && legal > (isPv ? 3 : 2) && (quiet || (o.see && this.scores[i] < 0)) && !inCheck && !givesCheck) {
          if (o.lmrLog) {
            reduction = LMR[Math.min(depth, 63) * 64 + Math.min(legal, 63)];
            if (isPv) reduction--;
            if (!improving) reduction++;
            if (isKiller) reduction--;
            if (quiet && o.history) reduction -= Math.trunc(this.history[this.historyIndex(pos.side ^ 1, m)] / 6000);
            if (reduction < 0) reduction = 0;
            if (reduction > newDepth - 1) reduction = Math.max(0, newDepth - 1);
          } else if (!isKiller) {
            reduction = legal > 6 && depth >= 5 ? 2 : 1;
            if (isPv && reduction > 1) reduction = 1;
          }
        }
        if (o.pvs) {
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
              if (o.killers && this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              if (o.history) {
                const bonus = Math.min(depth * depth, 400);
                this.updateHistory(this.historyIndex(pos.side, m), bonus);
                // Malus pour les coups calmes essayés avant sans succès.
                if (o.lmrLog) {
                  const n = Math.min(quietCount, 64);
                  for (let k = 0; k < n; k++) {
                    const q = this.quietsTried[qBase + k];
                    if (q !== m) this.updateHistory(this.historyIndex(pos.side, q), -bonus);
                  }
                }
              }
              if (o.countermove) {
                const ci = this.counterIndex();
                if (ci >= 0) this.counter[ci] = m;
              }
            }
            break;
          }
        }
      }
    }

    // Les élagages exigent au moins un coup légal déjà cherché : legal = 0 signifie mat ou pat.
    if (legal === 0) return inCheck ? -MATE + ply : 0;

    if (o.useTT) {
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
    return this.evalStm();
  }

  private qsearch(alpha: number, beta: number, ply: number): number {
    const pos = this.pos;
    const o = this.opts;
    this.nodes++;
    this.qnodes++;
    this.pvLength[ply] = ply;
    if (ply > this.seldepth) this.seldepth = ply;
    this.checkStop();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return this.evalStm();
    if (pos.isInsufficientMaterial()) return 0;

    const isPv = beta - alpha > 1;
    let ttMove = 0;
    if (o.qsTT && o.useTT && this.tt.probe(pos.hashLo, pos.hashHi)) {
      ttMove = this.tt.hitMove;
      if (!isPv) {
        const s = scoreFromTT(this.tt.hitScore, ply);
        const f = this.tt.hitFlag;
        if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
      }
    }

    const inCheck = pos.inCheck();
    let bestScore = -INF;
    let stand = -INF;
    const origAlpha = alpha;
    if (!inCheck) {
      stand = this.evalStm();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      bestScore = stand;
    }
    const start = ply * MOVE_STRIDE;
    // En échec : toutes les parades (permet de détecter les mats dans la quiescence).
    const end = pos.generateMoves(this.moves, start, !inCheck);
    this.scoreMoves(start, end, ttMove, ply);
    let legal = 0;
    let bestMove = 0;
    for (let i = start; i < end; i++) {
      const m = this.pickMove(i, end);
      const promo = movePromo(m);
      const isCap = (moveFlags(m) & FLAG_CAPTURE) !== 0;
      if (!inCheck) {
        // Hors échec, les sous-promotions sans capture sont ignorées.
        if (promo && promo !== QUEEN && !isCap) continue;
        if (o.see) {
          // Delta pruning : même en gagnant la pièce, impossible d'atteindre alpha.
          const victim = (pos.board[moveTo(m)] & 7) || PAWN;
          if (!promo && stand + SEE_VALUE[victim] + 200 <= alpha) continue;
          // Captures perdantes ignorées.
          if (this.scores[i] < 0 && see(pos, m) < 0) continue;
        }
      }
      if (!pos.makeMove(m)) continue;
      legal++;
      const score = -this.qsearch(-beta, -alpha, ply + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          this.updatePv(ply, m);
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    if (o.qsTT && o.useTT) {
      const flag = bestScore >= beta ? TT_LOWER : bestScore > origAlpha ? TT_EXACT : TT_UPPER;
      this.tt.store(pos.hashLo, pos.hashHi, 0, flag, scoreToTT(bestScore, ply), bestMove);
    }
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

