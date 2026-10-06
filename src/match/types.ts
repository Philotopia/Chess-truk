import type { GameResult, TerminationReason } from '../core/game';
import type { EngineConfig } from '../engine/params';
import type { SearchLimits } from '../engine/search';
import type { StockfishSettings } from '../stockfish/presets';
import type { UciLimits } from '../stockfish/uci';

export interface MoveDecision {
  uci: string | null;
  /** Score du point de vue du joueur qui joue le coup (centipawns), null si mat ou inconnu. */
  scoreCp: number | null;
  mate: number | null;
  depth: number;
  seldepth?: number;
  nodes: number;
  timeMs: number;
  pv: string[];
}

export interface LiveInfo {
  depth: number;
  scoreCp: number | null;
  mate: number | null;
  nodes: number;
  nps: number;
  pv: string[];
}

export interface Player {
  readonly name: string;
  readonly kind: 'truk' | 'stockfish';
  newGame(): Promise<void>;
  think(startFen: string, moves: string[], onInfo?: (i: LiveInfo) => void): Promise<MoveDecision>;
  dispose(): void;
}

export type PlayerSpec =
  | { kind: 'truk'; label: string; config: EngineConfig; limits: SearchLimits }
  | { kind: 'stockfish'; label: string; settings: StockfishSettings; limits: UciLimits; presetId?: string; refElo?: number };

export type PlayerFactory = (spec: PlayerSpec) => Promise<Player>;

export interface PlayedMove {
  uci: string;
  san: string;
  book: boolean;
  scoreCp: number | null;
  mate: number | null;
  depth: number;
  nodes: number;
  timeMs: number;
  pv: string[];
}

export interface GameRecord {
  index: number;
  /** Vrai si le joueur A (premier joueur du tournoi) a les blancs. */
  aIsWhite: boolean;
  white: string;
  black: string;
  openingName: string;
  startFen: string;
  moves: PlayedMove[];
  result: GameResult;
  reason: TerminationReason;
  errorMessage?: string;
  durationMs: number;
  pgn: string;
}

export interface AdjudicationSettings {
  enabled: boolean;
  /** Abandon si le joueur au trait s'évalue ≤ −resignCp et l'adversaire ≥ +resignCp pendant resignMoves coups chacun. */
  resignCp: number;
  resignMoves: number;
  /** Nulle si les deux évaluations restent dans ±drawCp pendant drawMoves coups chacun, après drawMinPly demi-coups. */
  drawCp: number;
  drawMoves: number;
  drawMinPly: number;
}

export function defaultAdjudication(): AdjudicationSettings {
  return { enabled: false, resignCp: 1000, resignMoves: 4, drawCp: 10, drawMoves: 12, drawMinPly: 80 };
}
