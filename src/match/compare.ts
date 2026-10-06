// Comparaison Truk / Stockfish : position par position et sur une partie complète.
// Convention : tous les scores stockés ici sont du point de vue des BLANCS (centipawns).

export interface EngineView {
  /** Score point de vue blancs (cp), mats convertis via mateToCp. */
  scoreWhite: number;
  mate: number | null;
  bestMove: string | null;
  depth: number;
  nodes: number;
  timeMs: number;
  pv: string[];
}

export interface PositionComparison {
  fen: string;
  truk: EngineView;
  sf: EngineView;
  /** Truk − Stockfish (point de vue blancs). */
  delta: number;
  sameMove: boolean;
}

export const MATE_CP = 10000;
/** Plafond utilisé pour la perte en centipawns (comme les outils usuels). */
export const CPL_CAP = 1000;

/** Convertit un score (camp au trait) en point de vue blancs ; un mat devient ±(MATE_CP − n). */
export function toWhitePov(scoreCp: number | null, mate: number | null, whiteToMove: boolean): number {
  let s: number;
  if (mate !== null) s = mate > 0 ? MATE_CP - mate : mate < 0 ? -MATE_CP - mate : -MATE_CP;
  else s = scoreCp ?? 0;
  return whiteToMove ? s : -s;
}

export function comparePosition(fen: string, truk: EngineView, sf: EngineView): PositionComparison {
  return { fen, truk, sf, delta: truk.scoreWhite - sf.scoreWhite, sameMove: !!truk.bestMove && truk.bestMove === sf.bestMove };
}

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export function classifyLoss(cpl: number): MoveClass {
  if (cpl >= 300) return 'blunder';
  if (cpl >= 100) return 'mistake';
  if (cpl >= 50) return 'inaccuracy';
  if (cpl <= 5) return 'best';
  return 'good';
}

export interface MoveAnalysis {
  ply: number;
  white: boolean;
  played: string;
  /** Perte en centipawns selon Stockfish (≥ 0). */
  cpl: number;
  cls: MoveClass;
  playedIsSfBest: boolean;
  playedIsTrukBest: boolean;
}

export interface SideSummary {
  moves: number;
  acpl: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  sfAgreement: number;
}

export interface GameAnalysisSummary {
  positions: number;
  /** Taux d'accord meilleur coup Truk = meilleur coup SF. */
  bestMoveAgreement: number;
  meanDelta: number;
  meanAbsError: number;
  white: SideSummary;
  black: SideSummary;
}

const cap = (x: number) => Math.max(-CPL_CAP, Math.min(CPL_CAP, x));

/**
 * positions[i] = analyse de la position avant le demi-coup i ; positions[n] = position finale.
 * played[i] = coup UCI joué au demi-coup i.
 */
export function analyzeMoves(positions: PositionComparison[], played: string[], whiteFirst: boolean): MoveAnalysis[] {
  const out: MoveAnalysis[] = [];
  for (let i = 0; i < played.length && i + 1 < positions.length; i++) {
    const white = (i % 2 === 0) === whiteFirst;
    const before = cap(positions[i].sf.scoreWhite);
    const after = cap(positions[i + 1].sf.scoreWhite);
    let cpl = white ? before - after : after - before;
    if (positions[i].sf.bestMove === played[i]) cpl = 0;
    cpl = Math.max(0, cpl);
    out.push({
      ply: i,
      white,
      played: played[i],
      cpl,
      cls: classifyLoss(cpl),
      playedIsSfBest: positions[i].sf.bestMove === played[i],
      playedIsTrukBest: positions[i].truk.bestMove === played[i],
    });
  }
  return out;
}

function side(moves: MoveAnalysis[]): SideSummary {
  const n = moves.length;
  return {
    moves: n,
    acpl: n ? moves.reduce((s, m) => s + m.cpl, 0) / n : 0,
    inaccuracies: moves.filter((m) => m.cls === 'inaccuracy').length,
    mistakes: moves.filter((m) => m.cls === 'mistake').length,
    blunders: moves.filter((m) => m.cls === 'blunder').length,
    sfAgreement: n ? moves.filter((m) => m.playedIsSfBest).length / n : 0,
  };
}

export function summarize(positions: PositionComparison[], moves: MoveAnalysis[]): GameAnalysisSummary {
  // Les positions terminales (sans coup) sont exclues des statistiques d'accord.
  const ps = positions.filter((p) => p.sf.bestMove !== null);
  const n = ps.length;
  const deltas = ps.map((p) => cap(p.truk.scoreWhite) - cap(p.sf.scoreWhite));
  return {
    positions: n,
    bestMoveAgreement: n ? ps.filter((p) => p.sameMove).length / n : 0,
    meanDelta: n ? deltas.reduce((s, d) => s + d, 0) / n : 0,
    meanAbsError: n ? deltas.reduce((s, d) => s + Math.abs(d), 0) / n : 0,
    white: side(moves.filter((m) => m.white)),
    black: side(moves.filter((m) => !m.white)),
  };
}
