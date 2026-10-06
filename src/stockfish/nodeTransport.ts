// Transport Node.js (scripts CLI et tests) : charge le module WASM du paquet npm « stockfish ».
import { createRequire } from 'node:module';
import type { StockfishFlavor } from './presets';
import type { UciTransport } from './uci';

interface NodeSfEngine {
  listener?: (l: string) => void;
  sendCommand(cmd: string): void;
  terminate?: () => void;
}

export async function createNodeStockfishTransport(flavor: StockfishFlavor = 'lite-single'): Promise<UciTransport> {
  const require = createRequire(import.meta.url);
  const init = require('stockfish') as (f: string) => Promise<NodeSfEngine>;
  const engine = await init(flavor);
  let cb: ((l: string) => void) | null = null;
  engine.listener = (l: string) => cb?.(l);
  return {
    send: (c) => engine.sendCommand(c),
    setListener: (f) => (cb = f),
    terminate: () => engine.terminate?.(),
  };
}
