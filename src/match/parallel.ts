// Tournoi parallèle (Node) : N workers jouent des parties en même temps. Arrêt anticipé possible (SPRT).
import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SF_VERSION } from '../stockfish/presets';
import { computeStats } from './stats';
import { APP_VERSION, type TournamentConfig, type TournamentRecord, newId } from './tournament';
import type { GameRecord } from './types';

export async function runParallelTournament(
  config: TournamentConfig,
  concurrency: number,
  onGameEnd?: (g: GameRecord, rec: TournamentRecord) => boolean | void,
): Promise<TournamentRecord> {
  const rec: TournamentRecord = {
    id: newId(),
    kind: 'tournament',
    createdAt: new Date().toISOString(),
    status: 'running',
    config: JSON.parse(JSON.stringify(config)),
    games: [],
    stats: computeStats([]),
    environment: { app: APP_VERSION, stockfish: SF_VERSION, userAgent: `node ${process.version}, ${concurrency} workers` },
  };
  let next = 0;
  let stop = false;
  const workers: ChildProcess[] = [];
  await new Promise<void>((resolve, reject) => {
    let active = 0;
    const dispatch = (w: ChildProcess) => {
      if (stop || next >= config.games) {
        w.send({ type: 'stop' });
        active--;
        if (active === 0) resolve();
        return;
      }
      w.send({ type: 'play', index: next++ });
    };
    const n = Math.max(1, Math.min(concurrency, config.games));
    for (let k = 0; k < n; k++) {
      const w = fork(fileURLToPath(new URL('./parallelWorker.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, TRUK_TOURNAMENT_CONFIG: JSON.stringify(config) },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      workers.push(w);
      active++;
      w.on('message', (m: { type: string; rec?: GameRecord | null; message?: string; index?: number }) => {
        if (m.type === 'ready') dispatch(w);
        else if (m.type === 'game') {
          if (m.rec) {
            rec.games.push(m.rec);
            rec.games.sort((a, b) => a.index - b.index);
            rec.stats = computeStats(rec.games);
            if (onGameEnd?.(m.rec, rec) === true) stop = true;
          }
          dispatch(w);
        } else if (m.type === 'error') {
          stop = true;
          reject(new Error(`Partie ${m.index} : ${m.message}`));
        }
      });
      w.on('error', (e) => reject(e));
      w.on('exit', (code) => {
        if (code && code !== 0 && !stop) reject(new Error(`processus de parties terminé (code ${code})`));
      });
    }
  });
  rec.status = stop && rec.games.length < config.games ? 'aborted' : 'finished';
  rec.finishedAt = new Date().toISOString();
  rec.stats = computeStats(rec.games);
  return rec;
}
