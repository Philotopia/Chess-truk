/// <reference lib="webworker" />
// Moteur Truk dans un Web Worker (page « Jouer contre Truk »).
import { TrukEngine } from '../src/engine/engine';
import { defaultEngineConfig } from '../src/engine/params';
import type { SearchLimits } from '../src/engine/search';

const engine = new TrukEngine(defaultEngineConfig('Truk V2'));

self.onmessage = (e: MessageEvent<{ id: number; startFen: string; moves: string[]; limits: SearchLimits; newGame?: boolean }>) => {
  const { id, startFen, moves, limits, newGame } = e.data;
  if (newGame) engine.newGame();
  try {
    const r = engine.searchGame(startFen, moves, limits);
    self.postMessage({ id, ok: true, result: r });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message });
  }
};
