// Façade du moteur « Truk » : configuration + recherche sur une partie (FEN de départ + coups UCI).

import { parseFen } from '../core/fen';
import { uciToMove } from '../core/notation';
import type { Position } from '../core/position';
import { type EngineConfig, cloneConfig } from './params';
import { type SearchInfo, type SearchLimits, type SearchResult, Searcher } from './search';

export class TrukEngine {
  config: EngineConfig;
  searcher: Searcher;

  constructor(config: EngineConfig) {
    this.config = cloneConfig(config);
    this.searcher = new Searcher(this.config.eval, this.config.search);
  }

  setConfig(config: EngineConfig): void {
    const prev = this.config.search;
    this.config = cloneConfig(config);
    if (prev.ttSizeMB !== config.search.ttSizeMB || prev.useTT !== config.search.useTT) {
      this.searcher = new Searcher(this.config.eval, this.config.search);
    } else {
      this.searcher.params = this.config.eval;
      this.searcher.opts = this.config.search;
      this.searcher.tt.clear();
    }
  }

  newGame(): void {
    this.searcher.newGame();
  }

  search(pos: Position, limits: SearchLimits, onInfo?: (i: SearchInfo) => void): SearchResult {
    return this.searcher.search(pos, limits, onInfo);
  }

  /** Recherche dans la position obtenue après `moves` depuis `startFen` (l'historique sert aux répétitions). */
  searchGame(startFen: string, moves: string[], limits: SearchLimits, onInfo?: (i: SearchInfo) => void): SearchResult {
    return this.searcher.search(buildPosition(startFen, moves), limits, onInfo);
  }
}

export function buildPosition(startFen: string, moves: string[]): Position {
  const pos = parseFen(startFen);
  for (const u of moves) {
    const m = uciToMove(pos, u);
    if (m === null) throw new Error(`Coup illégal ${u}`);
    pos.makeMove(m);
  }
  return pos;
}
