import type { StockfishFlavor } from './presets';
import type { UciTransport } from './uci';

/** Lance Stockfish WASM dans un Web Worker (fichiers servis localement depuis /stockfish). */
export function createBrowserStockfishTransport(flavor: StockfishFlavor): UciTransport {
  const url = `${import.meta.env.BASE_URL}stockfish/stockfish-18-${flavor}.js`;
  const worker = new Worker(url);
  let cb: ((l: string) => void) | null = null;
  worker.onmessage = (e: MessageEvent) => cb?.(typeof e.data === 'string' ? e.data : String(e.data));
  worker.onerror = (e) => cb?.(`info string worker error ${e.message}`);
  return {
    send: (c) => worker.postMessage(c),
    setListener: (f) => (cb = f),
    terminate: () => worker.terminate(),
  };
}

export function multiThreadAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}
