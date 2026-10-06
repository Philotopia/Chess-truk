// Réglages et préréglages de Stockfish (adversaire / benchmark).
import type { UciLimits } from './uci';

export type StockfishFlavor = 'lite-single' | 'lite';

export interface StockfishSettings {
  /** lite-single : 1 thread, fonctionne partout. lite : multi-thread, exige crossOriginIsolated. */
  flavor: StockfishFlavor;
  threads: number;
  hashMB: number;
  /** 0..20, null = non modifié (20). */
  skillLevel: number | null;
  limitStrength: boolean;
  /** UCI_Elo : 1320..3190 pour Stockfish 18. */
  elo: number;
}

export interface StockfishSpec {
  label: string;
  settings: StockfishSettings;
  limits: UciLimits;
}

export const SF_VERSION = 'Stockfish 18 Lite (WASM, NNUE réduit)';

export function defaultStockfishSettings(): StockfishSettings {
  return { flavor: 'lite-single', threads: 1, hashMB: 16, skillLevel: null, limitStrength: false, elo: 1320 };
}

const base = defaultStockfishSettings;

export interface StockfishPreset extends StockfishSpec {
  id: string;
  group: 'Niveau' | 'Elo' | 'Profondeur' | 'Nœuds' | 'Temps';
  /** Elo de référence si connu (UCI_Elo), pour l'estimation de performance. */
  refElo?: number;
  deterministic: boolean;
}

export const STOCKFISH_PRESETS: StockfishPreset[] = [
  { id: 'sf-very-weak', group: 'Niveau', label: 'SF très faible (Skill 0, prof. 5)', settings: { ...base(), skillLevel: 0 }, limits: { depth: 5 }, deterministic: false },
  { id: 'sf-weak', group: 'Niveau', label: 'SF faible (Skill 3, prof. 8)', settings: { ...base(), skillLevel: 3 }, limits: { depth: 8 }, deterministic: false },
  { id: 'sf-medium', group: 'Niveau', label: 'SF moyen (Skill 8, prof. 10)', settings: { ...base(), skillLevel: 8 }, limits: { depth: 10 }, deterministic: false },
  { id: 'sf-strong', group: 'Niveau', label: 'SF fort (Skill 14, prof. 12)', settings: { ...base(), skillLevel: 14 }, limits: { depth: 12 }, deterministic: false },
  ...[1320, 1500, 1800, 2100, 2400].map(
    (elo): StockfishPreset => ({
      id: `sf-elo-${elo}`,
      group: 'Elo',
      label: `SF UCI_Elo ${elo} (100 ms)`,
      settings: { ...base(), limitStrength: true, elo },
      limits: { movetime: 100 },
      refElo: elo,
      deterministic: false,
    }),
  ),
  ...Array.from({ length: 15 }, (_, i): StockfishPreset => ({
    id: `sf-depth-${i + 1}`,
    group: 'Profondeur',
    label: `SF profondeur ${i + 1}`,
    settings: base(),
    limits: { depth: i + 1 },
    deterministic: true,
  })),
  ...[100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000].map(
    (n): StockfishPreset => ({
      id: `sf-nodes-${n}`,
      group: 'Nœuds',
      label: `SF ${n.toLocaleString('fr-FR')} nœuds/coup`,
      settings: base(),
      limits: { nodes: n },
      deterministic: true,
    }),
  ),
  ...[100, 500, 1000, 5000].map(
    (ms): StockfishPreset => ({
      id: `sf-time-${ms}`,
      group: 'Temps',
      label: `SF ${ms} ms/coup`,
      settings: base(),
      limits: { movetime: ms },
      deterministic: false,
    }),
  ),
];

export const NODE_LADDER = [100, 300, 1000, 3000, 10000, 30000, 100000];

export const WASM_LIMITATIONS = [
  'Version « lite » : réseau NNUE réduit (~7 Mo), nettement moins forte que Stockfish natif (réseau complet > 100 Mo non embarqué).',
  'WebAssembly : 1 thread en version single ; la version multi-thread exige une page « cross-origin isolated » (en-têtes COOP/COEP fournis par le serveur Vite du projet).',
  'Vitesse : environ 2 à 5 fois plus lent que Stockfish natif sur la même machine.',
  'UCI_Elo est limité à 1320–3190 et calibré par Stockfish pour des cadences humaines, pas pour des budgets en nœuds.',
  'Skill Level / UCI_Elo introduisent un choix aléatoire (graine liée à l’horloge) : non reproductible.',
  'Le budget « nodes » est respecté approximativement (vérification périodique) : les nœuds réellement consommés sont enregistrés.',
];

/** Commandes setoption correspondant aux réglages. */
export function stockfishOptionCommands(s: StockfishSettings): [string, string | number | boolean][] {
  const out: [string, string | number | boolean][] = [
    ['Threads', s.flavor === 'lite' ? Math.max(1, s.threads) : 1],
    ['Hash', s.hashMB],
  ];
  out.push(['UCI_LimitStrength', s.limitStrength]);
  if (s.limitStrength) out.push(['UCI_Elo', Math.min(3190, Math.max(1320, s.elo))]);
  out.push(['Skill Level', s.skillLevel === null ? 20 : Math.min(20, Math.max(0, s.skillLevel))]);
  return out;
}

export function describeLimits(l: { depth?: number; nodes?: number; movetime?: number; timeMs?: number }): string {
  const parts: string[] = [];
  if (l.depth) parts.push(`prof. ${l.depth}`);
  if (l.nodes) parts.push(`${l.nodes.toLocaleString('fr-FR')} nœuds`);
  const t = l.movetime ?? l.timeMs;
  if (t) parts.push(`${t} ms`);
  return parts.join(' / ') || 'aucune limite';
}
