// Joueurs « en ligne » (même thread) : utilisés par les scripts Node et les tests.
// Dans le navigateur, le moteur Truk tourne dans un Web Worker (voir src/workers).
import { TrukEngine } from '../engine/engine';
import type { EngineConfig } from '../engine/params';
import type { SearchLimits } from '../engine/search';
import { type StockfishSettings, stockfishOptionCommands } from '../stockfish/presets';
import type { UciEngine, UciLimits } from '../stockfish/uci';
import type { LiveInfo, MoveDecision, Player } from './types';

export class TrukInlinePlayer implements Player {
  readonly kind = 'truk' as const;
  private engine: TrukEngine;
  constructor(
    readonly name: string,
    config: EngineConfig,
    private limits: SearchLimits,
  ) {
    this.engine = new TrukEngine(config);
  }
  async newGame(): Promise<void> {
    this.engine.newGame();
  }
  async think(startFen: string, moves: string[], onInfo?: (i: LiveInfo) => void): Promise<MoveDecision> {
    const r = this.engine.searchGame(startFen, moves, this.limits, (i) =>
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
  dispose(): void {}
}

/** Applique les réglages Stockfish (options UCI disponibles uniquement). */
export async function applyStockfishSettings(uci: UciEngine, s: StockfishSettings): Promise<void> {
  for (const [name, value] of stockfishOptionCommands(s)) {
    if (uci.hasOption(name)) await uci.setOption(name, value);
  }
}

export class StockfishPlayer implements Player {
  readonly kind = 'stockfish' as const;
  constructor(
    readonly name: string,
    private uci: UciEngine,
    private limits: UciLimits,
  ) {}
  async newGame(): Promise<void> {
    await this.uci.newGame();
  }
  async think(startFen: string, moves: string[], onInfo?: (i: LiveInfo) => void): Promise<MoveDecision> {
    const t0 = performance.now();
    const r = await this.uci.go(startFen, moves, this.limits, (i) =>
      onInfo?.({ depth: i.depth, scoreCp: i.scoreCp, mate: i.mate, nodes: i.nodes, nps: i.nps, pv: i.pv }),
    );
    return {
      uci: r.bestMove,
      scoreCp: r.scoreCp,
      mate: r.mate,
      depth: r.depth,
      seldepth: r.seldepth,
      nodes: r.nodes,
      timeMs: r.timeMs || performance.now() - t0,
      pv: r.pv,
    };
  }
  dispose(): void {
    this.uci.quit();
  }
}
