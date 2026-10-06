// Client du Web Worker Truk. stop() interrompt la recherche en recréant le worker
// (la recherche est synchrone dans le worker) et renvoie la dernière information connue.
import type { EngineConfig } from '../engine/params';
import { mateIn, type SearchInfo, type SearchLimits, type SearchResult } from '../engine/search';

interface Pending {
  resolve: (r: SearchResult) => void;
  reject: (e: Error) => void;
  onInfo?: (i: SearchInfo) => void;
  last?: SearchInfo;
}

export class TrukWorkerClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id: number; info?: SearchInfo; result?: SearchResult; message?: string };
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'info' && msg.info) {
        p.last = msg.info;
        p.onInfo?.(msg.info);
      } else if (msg.type === 'result' && msg.result) {
        this.pending.delete(msg.id);
        p.resolve(msg.result);
      } else if (msg.type === 'error') {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    };
    this.worker.onerror = (e) => {
      for (const [id, p] of this.pending) {
        p.reject(new Error(`Worker moteur : ${e.message}`));
        this.pending.delete(id);
      }
    };
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  search(
    config: EngineConfig,
    startFen: string,
    moves: string[],
    limits: SearchLimits,
    onInfo?: (i: SearchInfo) => void,
  ): Promise<SearchResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onInfo });
      this.worker.postMessage({ type: 'search', id, config, startFen, moves, limits });
    });
  }

  newGame(): void {
    this.worker.postMessage({ type: 'newGame' });
  }

  /** Interrompt la recherche en cours : résout avec la dernière itération terminée. */
  stop(): void {
    if (!this.pending.size) return;
    this.worker.terminate();
    for (const [, p] of this.pending) {
      const l = p.last;
      p.resolve({
        depth: l?.depth ?? 0,
        seldepth: l?.seldepth ?? 0,
        score: l?.score ?? 0,
        mate: l ? mateIn(l.score) : null,
        nodes: l?.nodes ?? 0,
        timeMs: l?.timeMs ?? 0,
        nps: l?.nps ?? 0,
        pv: l?.pv ?? [],
        hashfull: l?.hashfull ?? 0,
        bestMove: l?.pv[0] ?? null,
        completedDepth: l?.depth ?? 0,
        stopped: true,
        ttSizeMB: 0,
        ttHits: 0,
        ttProbes: 0,
        qnodes: 0,
      });
    }
    this.pending.clear();
    this.spawn();
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
