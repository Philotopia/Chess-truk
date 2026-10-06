// Statistiques de match : score, Elo estimé, intervalle de confiance, LOS.
import type { GameRecord } from './types';

export interface MatchStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Score de A en [0,1]. */
  score: number;
  /** Différence Elo estimée A − B (null si 0 % ou 100 %). */
  elo: number | null;
  /** Intervalle de confiance à 95 % sur la différence Elo. */
  eloLow: number | null;
  eloHigh: number | null;
  /** Probabilité de supériorité de A (likelihood of superiority). */
  los: number | null;
  scoreLow: number;
  scoreHigh: number;
  avgPlies: number;
  avgDurationMs: number;
  asWhite: { w: number; d: number; l: number };
  asBlack: { w: number; d: number; l: number };
  a: SideStats;
  b: SideStats;
  reasons: Record<string, number>;
}

export interface SideStats {
  moves: number;
  avgNodes: number;
  avgDepth: number;
  avgTimeMs: number;
  /** Nœuds par seconde moyens. */
  nps: number;
}

export function eloFromScore(p: number): number {
  return -400 * Math.log10(1 / p - 1);
}

function erf(x: number): number {
  // Approximation d'Abramowitz et Stegun 7.1.26.
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}

/** Score de A pour une partie (1, 0.5, 0) ou null si non terminée. */
export function scoreForA(g: GameRecord): number | null {
  if (g.result === '1/2-1/2') return 0.5;
  if (g.result === '1-0') return g.aIsWhite ? 1 : 0;
  if (g.result === '0-1') return g.aIsWhite ? 0 : 1;
  return null;
}

function sideStats(games: GameRecord[], isA: boolean): SideStats {
  let moves = 0;
  let nodes = 0;
  let depth = 0;
  let time = 0;
  for (const g of games) {
    const aWhite = g.aIsWhite;
    g.moves.forEach((m, i) => {
      if (m.book) return;
      const whiteMove = isWhiteMove(g.startFen, i);
      const byA = whiteMove === aWhite;
      if (byA !== isA) return;
      moves++;
      nodes += m.nodes;
      depth += m.depth;
      time += m.timeMs;
    });
  }
  return {
    moves,
    avgNodes: moves ? nodes / moves : 0,
    avgDepth: moves ? depth / moves : 0,
    avgTimeMs: moves ? time / moves : 0,
    nps: time > 0 ? (nodes * 1000) / time : 0,
  };
}

export function isWhiteMove(startFen: string, plyIndex: number): boolean {
  const whiteFirst = startFen.split(' ')[1] !== 'b';
  return (plyIndex % 2 === 0) === whiteFirst;
}

export function computeStats(games: GameRecord[]): MatchStats {
  let w = 0;
  let d = 0;
  let l = 0;
  const asWhite = { w: 0, d: 0, l: 0 };
  const asBlack = { w: 0, d: 0, l: 0 };
  const reasons: Record<string, number> = {};
  const done = games.filter((g) => scoreForA(g) !== null);
  for (const g of done) {
    const s = scoreForA(g)!;
    const bucket = g.aIsWhite ? asWhite : asBlack;
    if (s === 1) {
      w++;
      bucket.w++;
    } else if (s === 0) {
      l++;
      bucket.l++;
    } else {
      d++;
      bucket.d++;
    }
    reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
  }
  const n = w + d + l;
  const score = n ? (w + d / 2) / n : 0;
  let elo: number | null = null;
  let eloLow: number | null = null;
  let eloHigh: number | null = null;
  let los: number | null = null;
  let scoreLow = 0;
  let scoreHigh = 1;
  if (n > 0) {
    // Variance par partie du modèle trinomial V/N/D.
    const variance = (w * (1 - score) ** 2 + d * (0.5 - score) ** 2 + l * (0 - score) ** 2) / n;
    const z = 1.96;
    if (variance > 0) {
      const se = Math.sqrt(variance / n);
      scoreLow = Math.max(0, score - z * se);
      scoreHigh = Math.min(1, score + z * se);
    } else {
      // Résultats tous identiques : intervalle de Wilson (l'approximation normale serait dégénérée).
      const den = 1 + (z * z) / n;
      const center = (score + (z * z) / (2 * n)) / den;
      const half = (z * Math.sqrt((score * (1 - score)) / n + (z * z) / (4 * n * n))) / den;
      scoreLow = Math.max(0, center - half);
      scoreHigh = Math.min(1, center + half);
    }
    const clamp = (x: number) => Math.min(0.9999, Math.max(0.0001, x));
    if (score > 0 && score < 1) elo = eloFromScore(score);
    eloLow = eloFromScore(clamp(scoreLow));
    eloHigh = eloFromScore(clamp(scoreHigh));
    if (w + l > 0) los = 0.5 * (1 + erf((w - l) / Math.sqrt(2 * (w + l))));
  }
  const avgPlies = done.length ? done.reduce((s, g) => s + g.moves.length, 0) / done.length : 0;
  const avgDurationMs = done.length ? done.reduce((s, g) => s + g.durationMs, 0) / done.length : 0;
  return {
    games: n,
    wins: w,
    draws: d,
    losses: l,
    score,
    elo,
    eloLow,
    eloHigh,
    los,
    scoreLow,
    scoreHigh,
    avgPlies,
    avgDurationMs,
    asWhite,
    asBlack,
    a: sideStats(done, true),
    b: sideStats(done, false),
    reasons,
  };
}
