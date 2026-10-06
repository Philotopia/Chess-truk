// Fabrique de joueurs pour Node.js (scripts CLI, tests d'intégration).
import { createNodeStockfishTransport } from '../stockfish/nodeTransport';
import { UciEngine } from '../stockfish/uci';
import { StockfishPlayer, TrukInlinePlayer, applyStockfishSettings } from './players';
import type { Player, PlayerSpec } from './types';

export async function createNodePlayer(spec: PlayerSpec): Promise<Player> {
  if (spec.kind === 'truk') return new TrukInlinePlayer(spec.label, spec.config, spec.limits);
  const uci = new UciEngine(await createNodeStockfishTransport(spec.settings.flavor === 'lite' ? 'lite' : 'lite-single'));
  await uci.init();
  await applyStockfishSettings(uci, spec.settings);
  await uci.isReady();
  return new StockfishPlayer(spec.label, uci, spec.limits);
}
