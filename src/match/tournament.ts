// Gestionnaire de tournoi : alternance des couleurs, ouvertures appariées, conservation complète
// de la configuration pour la reproductibilité.
import { START_FEN } from '../core/types';
import { SF_VERSION } from '../stockfish/presets';
import { openingForGame, openingToUci } from './openings';
import { playGame, type PlayGameOptions } from './runner';
import { type MatchStats, computeStats } from './stats';
import type { AdjudicationSettings, GameRecord, LiveInfo, PlayedMove, PlayerFactory, PlayerSpec } from './types';
import type { Game } from '../core/game';

export const APP_VERSION = '0.1.0';

export interface TournamentConfig {
  name: string;
  a: PlayerSpec;
  b: PlayerSpec;
  games: number;
  openings: 'book' | 'startpos';
  /** Décalage dans le livre (pour varier les ouvertures entre deux tournois). */
  openingOffset: number;
  maxPlies: number;
  adjudication: AdjudicationSettings;
}

export interface TournamentRecord {
  id: string;
  kind: 'tournament' | 'ladder-step';
  createdAt: string;
  finishedAt?: string;
  status: 'running' | 'finished' | 'aborted';
  config: TournamentConfig;
  games: GameRecord[];
  stats: MatchStats;
  environment: { app: string; stockfish: string; userAgent: string };
  /** Groupe de l'échelle de difficulté (le cas échéant). */
  ladderId?: string;
  ladderValue?: number;
}

export interface TournamentCallbacks {
  onGameStart?: (index: number, whiteName: string, blackName: string, openingName: string) => void;
  onMove?: (index: number, game: Game, move: PlayedMove) => void;
  onInfo?: PlayGameOptions['onInfo'];
  onGameEnd?: (record: GameRecord, rec: TournamentRecord) => void;
  shouldAbort?: () => boolean;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function runTournament(
  config: TournamentConfig,
  factory: PlayerFactory,
  cb: TournamentCallbacks = {},
  extra: Partial<TournamentRecord> = {},
): Promise<TournamentRecord> {
  const rec: TournamentRecord = {
    id: newId(),
    kind: 'tournament',
    createdAt: new Date().toISOString(),
    status: 'running',
    config: JSON.parse(JSON.stringify(config)),
    games: [],
    stats: computeStats([]),
    environment: {
      app: APP_VERSION,
      stockfish: SF_VERSION,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : `node ${typeof process !== 'undefined' ? process.version : ''}`,
    },
    ...extra,
  };
  const pa = await factory(config.a);
  const pb = await factory(config.b);
  try {
    for (let i = 0; i < config.games; i++) {
      if (cb.shouldAbort?.()) {
        rec.status = 'aborted';
        break;
      }
      const aIsWhite = i % 2 === 0;
      const white = aIsWhite ? pa : pb;
      const black = aIsWhite ? pb : pa;
      const opening = openingForGame(i, config.openings, config.openingOffset);
      cb.onGameStart?.(i, white.name, black.name, opening.name);
      const played = await playGame(white, black, {
        startFen: START_FEN,
        openingMoves: openingToUci(opening),
        maxPlies: config.maxPlies,
        adjudication: config.adjudication,
        pgnHeaders: { Event: config.name, Round: String(i + 1), Opening: opening.name },
        onMove: (g, m) => cb.onMove?.(i, g, m),
        onInfo: cb.onInfo,
        shouldAbort: cb.shouldAbort,
      });
      if (played.reason === 'aborted') {
        rec.status = 'aborted';
        break;
      }
      const gr: GameRecord = {
        index: i,
        aIsWhite,
        white: white.name,
        black: black.name,
        openingName: opening.name,
        startFen: played.game.startFen,
        moves: played.moves,
        result: played.result,
        reason: played.reason,
        errorMessage: played.errorMessage,
        durationMs: played.durationMs,
        pgn: played.pgn,
      };
      rec.games.push(gr);
      rec.stats = computeStats(rec.games);
      cb.onGameEnd?.(gr, rec);
    }
    if (rec.status === 'running') rec.status = 'finished';
  } finally {
    pa.dispose();
    pb.dispose();
  }
  rec.finishedAt = new Date().toISOString();
  rec.stats = computeStats(rec.games);
  return rec;
}

export function tournamentPgn(rec: TournamentRecord): string {
  return rec.games.map((g) => g.pgn).join('\n');
}

export type { LiveInfo };
