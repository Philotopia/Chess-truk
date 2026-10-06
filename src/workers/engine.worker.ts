/// <reference lib="webworker" />
// Web Worker du moteur Truk : la recherche tourne hors du thread de l'interface.
import { TrukEngine } from '../engine/engine';
import type { EngineConfig } from '../engine/params';
import type { SearchLimits } from '../engine/search';

export type EngineRequest =
  | { type: 'search'; id: number; config: EngineConfig; startFen: string; moves: string[]; limits: SearchLimits }
  | { type: 'newGame' };

let engine: TrukEngine | null = null;
let configKey = '';

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  const msg = e.data;
  if (msg.type === 'newGame') {
    engine?.newGame();
    return;
  }
  if (msg.type === 'search') {
    try {
      const key = JSON.stringify(msg.config);
      if (!engine) engine = new TrukEngine(msg.config);
      else if (key !== configKey) engine.setConfig(msg.config);
      configKey = key;
      const result = engine.searchGame(msg.startFen, msg.moves, msg.limits, (info) =>
        self.postMessage({ type: 'info', id: msg.id, info }),
      );
      self.postMessage({ type: 'result', id: msg.id, result });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: (err as Error).message });
    }
  }
};
