// Instances partagées pour l'analyse (hors matchs) : un worker Truk et un Stockfish WASM.
import type { EngineConfig } from '../engine/params';
import type { SearchInfo, SearchLimits, SearchResult } from '../engine/search';
import { createStockfishEngine } from '../match/factoryBrowser';
import { applyStockfishSettings } from '../match/players';
import type { StockfishSettings } from '../stockfish/presets';
import type { UciEngine, UciInfo, UciLimits, UciResult } from '../stockfish/uci';
import { TrukWorkerClient } from '../workers/engineClient';

let truk: TrukWorkerClient | null = null;
export function analysisTruk(): TrukWorkerClient {
  if (!truk) truk = new TrukWorkerClient();
  return truk;
}

export function trukAnalyze(
  config: EngineConfig,
  limits: SearchLimits,
  startFen: string,
  moves: string[],
  onInfo?: (i: SearchInfo) => void,
): Promise<SearchResult> {
  return analysisTruk().search(config, startFen, moves, limits, onInfo);
}

let sf: Promise<UciEngine> | null = null;
let sfFlavor = '';
let sfKey = '';

export async function analysisStockfish(settings: StockfishSettings): Promise<UciEngine> {
  if (!sf || sfFlavor !== settings.flavor) {
    if (sf) (await sf.catch(() => null))?.quit();
    sfFlavor = settings.flavor;
    sfKey = '';
    sf = createStockfishEngine(settings.flavor);
    sf.catch(() => {
      sf = null;
    });
  }
  const eng = await sf;
  const key = JSON.stringify(settings);
  if (key !== sfKey) {
    await applyStockfishSettings(eng, settings);
    await eng.isReady();
    sfKey = key;
  }
  return eng;
}

export async function sfAnalyze(
  settings: StockfishSettings,
  limits: UciLimits,
  startFen: string,
  moves: string[],
  onInfo?: (i: UciInfo) => void,
): Promise<UciResult> {
  const eng = await analysisStockfish(settings);
  return eng.go(startFen, moves, limits, onInfo);
}

export async function sfStop(): Promise<void> {
  if (sf) (await sf.catch(() => null))?.stop();
}

export async function sfInfo(settings: StockfishSettings): Promise<{ name: string; options: UciEngine['options'] }> {
  const eng = await analysisStockfish(settings);
  return { name: eng.name, options: eng.options };
}
