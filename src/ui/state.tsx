import { createContext, useContext, type ReactNode } from 'react';
import { type EngineConfig, defaultEngineConfig, normalizeConfig } from '../engine/params';
import type { SearchLimits } from '../engine/search';
import { type StockfishSettings, defaultStockfishSettings } from '../stockfish/presets';
import type { UciLimits } from '../stockfish/uci';
import { usePersistent } from './usePersistent';

export interface LabState {
  config: EngineConfig;
  setConfig: (c: EngineConfig) => void;
  trukLimits: SearchLimits;
  setTrukLimits: (l: SearchLimits) => void;
  sfSettings: StockfishSettings;
  setSfSettings: (s: StockfishSettings) => void;
  sfLimits: UciLimits;
  setSfLimits: (l: UciLimits) => void;
}

const Ctx = createContext<LabState | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = usePersistent<EngineConfig>('lab.config', () => defaultEngineConfig(), normalizeConfig);
  const [trukLimits, setTrukLimits] = usePersistent<SearchLimits>('lab.trukLimits', () => ({ timeMs: 1000 }));
  const [sfSettings, setSfSettings] = usePersistent<StockfishSettings>('lab.sfSettings', defaultStockfishSettings, (r) => ({
    ...defaultStockfishSettings(),
    ...(r as object),
  }));
  const [sfLimits, setSfLimits] = usePersistent<UciLimits>('lab.sfLimits', () => ({ depth: 12 }));
  return (
    <Ctx.Provider value={{ config, setConfig, trukLimits, setTrukLimits, sfSettings, setSfSettings, sfLimits, setSfLimits }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLab(): LabState {
  const c = useContext(Ctx);
  if (!c) throw new Error('LabProvider manquant');
  return c;
}
