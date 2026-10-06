// Déroulement d'une partie entre deux joueurs (moteur Truk, Stockfish…), avec arbitrage complet des règles.
import { Game, type GameResult, type TerminationReason } from '../core/game';
import { exportPgn } from '../core/pgn';
import { START_FEN } from '../core/types';
import type { AdjudicationSettings, LiveInfo, PlayedMove, Player } from './types';

export interface PlayGameOptions {
  startFen?: string;
  openingMoves?: string[];
  maxPlies?: number;
  adjudication?: AdjudicationSettings;
  pgnHeaders?: Record<string, string>;
  onMove?: (game: Game, move: PlayedMove) => void;
  onInfo?: (info: LiveInfo, whiteToMove: boolean) => void;
  shouldAbort?: () => boolean;
}

export interface PlayedGame {
  game: Game;
  moves: PlayedMove[];
  result: GameResult;
  reason: TerminationReason;
  errorMessage?: string;
  durationMs: number;
  pgn: string;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function playGame(white: Player, black: Player, opts: PlayGameOptions = {}): Promise<PlayedGame> {
  const t0 = now();
  const game = new Game(opts.startFen ?? START_FEN);
  const moves: PlayedMove[] = [];
  for (const u of opts.openingMoves ?? []) {
    const gm = game.playUci(u);
    const pm: PlayedMove = { uci: gm.uci, san: gm.san, book: true, scoreCp: null, mate: null, depth: 0, nodes: 0, timeMs: 0, pv: [] };
    moves.push(pm);
    opts.onMove?.(game, pm);
  }
  await white.newGame();
  await black.newGame();
  const maxPlies = opts.maxPlies ?? 400;
  const adj = opts.adjudication;
  let result: GameResult = '*';
  let reason: TerminationReason = 'none';
  let errorMessage: string | undefined;

  for (;;) {
    const st = game.status();
    if (st.over) {
      result = st.result;
      reason = st.reason;
      break;
    }
    if (game.moves.length >= maxPlies) {
      result = '1/2-1/2';
      reason = 'max-moves';
      break;
    }
    if (opts.shouldAbort?.()) {
      result = '*';
      reason = 'aborted';
      break;
    }
    const whiteToMove = game.pos.side === 0;
    const player = whiteToMove ? white : black;
    let dec;
    try {
      dec = await player.think(game.startFen, game.uciMoves(), (i) => opts.onInfo?.(i, whiteToMove));
    } catch (e) {
      result = whiteToMove ? '0-1' : '1-0';
      reason = 'error';
      errorMessage = `${player.name} : ${(e as Error).message}`;
      break;
    }
    if (opts.shouldAbort?.()) {
      result = '*';
      reason = 'aborted';
      break;
    }
    let san: string;
    try {
      if (!dec.uci) throw new Error('aucun coup renvoyé');
      san = game.playUci(dec.uci).san;
    } catch (e) {
      result = whiteToMove ? '0-1' : '1-0';
      reason = 'error';
      errorMessage = `${player.name} : coup illégal (${dec.uci}) — ${(e as Error).message}`;
      break;
    }
    const pm: PlayedMove = {
      uci: dec.uci!,
      san,
      book: false,
      scoreCp: dec.scoreCp,
      mate: dec.mate,
      depth: dec.depth,
      nodes: dec.nodes,
      timeMs: dec.timeMs,
      pv: dec.pv,
    };
    moves.push(pm);
    opts.onMove?.(game, pm);
    if (adj?.enabled) {
      const a = adjudicate(moves, adj, game.moves.length);
      if (a) {
        // Le gagnant est le camp dont l'évaluation est positive.
        if (a === 'draw') {
          result = '1/2-1/2';
        } else {
          // a = 'mover-wins' : le joueur qui vient de jouer gagne.
          result = whiteToMove ? (a === 'mover-wins' ? '1-0' : '0-1') : a === 'mover-wins' ? '0-1' : '1-0';
        }
        reason = 'adjudication';
        break;
      }
    }
  }
  const durationMs = now() - t0;
  const comments: Record<number, string> = {};
  moves.forEach((m, i) => {
    if (m.book) comments[i] = 'livre';
    else if (m.mate !== null) comments[i] = `#${m.mate} d${m.depth} n${m.nodes}`;
    else if (m.scoreCp !== null) comments[i] = `${(m.scoreCp / 100).toFixed(2)} d${m.depth} n${m.nodes}`;
  });
  const termination: Record<string, string> = {};
  if (reason !== 'none') termination.Termination = reason;
  const pgn = exportPgn(
    game,
    { White: white.name, Black: black.name, ...(opts.pgnHeaders ?? {}), ...termination },
    result,
    comments,
  );
  return { game, moves, result, reason, errorMessage, durationMs, pgn };
}

/** Score du point de vue du joueur qui a joué le coup ; les mats sont convertis en ±100000. */
function moveScore(m: PlayedMove): number | null {
  if (m.mate !== null) return m.mate > 0 ? 100000 : -100000;
  return m.scoreCp;
}

function adjudicate(moves: PlayedMove[], adj: AdjudicationSettings, plies: number): 'mover-wins' | 'mover-loses' | 'draw' | null {
  const n = moves.length;
  // Coups alternés : le dernier coup est celui du joueur qui vient de jouer.
  const need = Math.max(adj.resignMoves, adj.drawMoves) * 2;
  if (n < 2) return null;
  const recent = moves.slice(Math.max(0, n - need));
  if (recent.some((m) => m.book)) return null;
  const mover: number[] = [];
  const other: number[] = [];
  for (let i = recent.length - 1, k = 0; i >= 0; i--, k++) {
    const s = moveScore(recent[i]);
    if (s === null) return null;
    (k % 2 === 0 ? mover : other).push(s);
  }
  const rm = adj.resignMoves;
  if (mover.length >= rm && other.length >= rm) {
    if (mover.slice(0, rm).every((s) => s >= adj.resignCp) && other.slice(0, rm).every((s) => s <= -adj.resignCp)) return 'mover-wins';
    if (mover.slice(0, rm).every((s) => s <= -adj.resignCp) && other.slice(0, rm).every((s) => s >= adj.resignCp)) return 'mover-loses';
  }
  const dm = adj.drawMoves;
  if (plies >= adj.drawMinPly && mover.length >= dm && other.length >= dm) {
    if (mover.slice(0, dm).every((s) => Math.abs(s) <= adj.drawCp) && other.slice(0, dm).every((s) => Math.abs(s) <= adj.drawCp))
      return 'draw';
  }
  return null;
}
