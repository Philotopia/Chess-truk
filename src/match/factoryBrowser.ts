// Fabrique de joueurs pour le navigateur : Truk dans un Web Worker, Stockfish WASM dans un autre.
import { createBrowserStockfishTransport, multiThreadAvailable } from '../stockfish/browserTransport';
import { UciEngine } from '../stockfish/uci';
import { TrukWorkerClient } from '../workers/engineClient';
import { StockfishPlayer, applyStockfishSettings } from './players';
import type { EngineConfig } from '../engine/params';
import type { SearchLimits } from '../engine/search';
import type { LiveInfo, MoveDecision, Player, PlayerSpec } from './types';

export class TrukWorkerPlayer implements Player {
  readonly kind = 'truk' as const;
  private client = new TrukWorkerClient();
  constructor(
    readonly name: string,
    private config: EngineConfig,
    private limits: SearchLimits,
  ) {}
  async newGame(): Promise<void> {
    this.client.newGame();
  }
  async think(startFen: string, moves: string[], onInfo?: (i: LiveInfo) => void): Promise<MoveDecision> {
    const r = await this.client.search(this.config, startFen, moves, this.limits, (i) =>
      onInfo?.({ depth: i.depth, scoreCp: i.mate === null ? i.score : null, mate: i.mate, nodes: i.nodes, nps: i.nps, pv: i.pv }),
    );
    return {
      uci: r.bestMove,
      scoreCp: r.mate === null ? r.score : null,
      mate: r.mate,
      depth: r.completedDepth,
      seldepth: r.seldepth,
      nodes: r.nodes,
      timeMs: r.timeMs,
      pv: r.pv,
    };
  }
  dispose(): void {
    this.client.dispose();
  }
}

export async function createStockfishEngine(flavor: 'lite' | 'lite-single'): Promise<UciEngine> {
  const f = flavor === 'lite' && multiThreadAvailable() ? 'lite' : 'lite-single';
  const uci = new UciEngine(createBrowserStockfishTransport(f));
  await uci.init();
  return uci;
}

export async function createBrowserPlayer(spec: PlayerSpec): Promise<Player> {
  if (spec.kind === 'truk') return new TrukWorkerPlayer(spec.label, spec.config, spec.limits);
  const uci = await createStockfishEngine(spec.settings.flavor);
  await applyStockfishSettings(uci, spec.settings);
  await uci.isReady();
  return new StockfishPlayer(spec.label, uci, spec.limits);
}
