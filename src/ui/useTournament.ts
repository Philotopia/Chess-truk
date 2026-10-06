import { useRef, useState } from 'react';
import { createBrowserPlayer } from '../match/factoryBrowser';
import { type TournamentConfig, type TournamentRecord, runTournament } from '../match/tournament';
import type { LiveInfo } from '../match/types';
import { putItem } from '../storage/db';

export interface LiveState {
  gameIndex: number;
  white: string;
  black: string;
  opening: string;
  fen: string;
  lastMove: { from: string; to: string } | null;
  plies: number;
  info: LiveInfo | null;
  whiteToMove: boolean;
}

/** Exécute un tournoi dans le navigateur et expose l'état en direct ; chaque partie est sauvegardée. */
export function useTournament() {
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [record, setRecord] = useState<TournamentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef(false);
  const lastInfoTs = useRef(0);

  const run = async (config: TournamentConfig, extra: Partial<TournamentRecord> = {}): Promise<TournamentRecord | null> => {
    abort.current = false;
    setRunning(true);
    setError(null);
    setRecord(null);
    try {
      const rec = await runTournament(
        config,
        createBrowserPlayer,
        {
          onGameStart: (i, w, b, o) =>
            setLive({ gameIndex: i, white: w, black: b, opening: o, fen: '', lastMove: null, plies: 0, info: null, whiteToMove: true }),
          onMove: (_i, g, m) =>
            setLive((l) =>
              l
                ? { ...l, fen: g.fen, lastMove: { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) }, plies: g.moves.length, info: null, whiteToMove: g.pos.side === 0 }
                : l,
            ),
          onInfo: (info, whiteToMove) => {
            const now = performance.now();
            if (now - lastInfoTs.current < 100) return;
            lastInfoTs.current = now;
            setLive((l) => (l ? { ...l, info, whiteToMove } : l));
          },
          onGameEnd: (_g, r) => {
            const snapshot: TournamentRecord = JSON.parse(JSON.stringify(r));
            setRecord(snapshot);
            void putItem('tournaments', snapshot);
          },
          shouldAbort: () => abort.current,
        },
        extra,
      );
      setRecord(rec);
      await putItem('tournaments', rec);
      return rec;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setRunning(false);
      setLive(null);
    }
  };

  const stop = () => {
    abort.current = true;
  };

  return { running, live, record, error, run, stop, aborted: () => abort.current };
}
