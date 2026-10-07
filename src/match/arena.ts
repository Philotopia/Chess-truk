// Arène des valeurs de pièces : pour une pièce, plusieurs variantes (valeur de référence + décalage) affrontent
// la configuration de référence ; la courbe « Elo mesuré en fonction du décalage » est ajustée par une parabole
// passant par l'origine (décalage 0 = référence = 0 Elo). Le sommet de la parabole estime la valeur optimale.
// L'incertitude est estimée par bootstrap paramétrique sur les Elo mesurés.

export interface ArenaPoint {
  /** Décalage appliqué à la valeur de référence (cp). */
  offset: number;
  /** Elo de la variante par rapport à la référence. */
  elo: number;
  /** Écart-type de l'estimation d'Elo. */
  se: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface ParabolaFit {
  /** Elo(d) ≈ b·d + c·d² */
  b: number;
  c: number;
  /** Décalage optimal −b/(2c) si la parabole est concave, sinon null. */
  optimum: number | null;
  /** Gain d'Elo estimé au sommet. */
  gainAtOptimum: number | null;
}

export interface ArenaEstimate extends ParabolaFit {
  /** Intervalle à 95 % du décalage optimal (bootstrap), borné à la plage testée élargie. */
  low: number | null;
  high: number | null;
  /** Part des tirages bootstrap donnant une parabole concave. */
  concaveShare: number;
}

/** Elo et écart-type à partir d'un bilan V/N/D (modèle trinomial). */
export function eloWithSe(w: number, d: number, l: number): { elo: number; se: number } {
  const n = w + d + l;
  const p = Math.min(1 - 1e-4, Math.max(1e-4, (w + d / 2) / n));
  const v = (w * (1 - p) ** 2 + d * (0.5 - p) ** 2 + l * p * p) / n;
  const seP = Math.sqrt(Math.max(v, 1e-6) / n);
  const elo = -400 * Math.log10(1 / p - 1);
  const se = (seP * 400) / (Math.LN10 * p * (1 - p));
  return { elo, se };
}

/** Moindres carrés pondérés de y = b·x + c·x² (sans constante). */
export function fitParabola(points: { offset: number; elo: number; se: number }[]): ParabolaFit {
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t1 = 0;
  let t2 = 0;
  for (const p of points) {
    if (p.offset === 0) continue;
    const w = 1 / (p.se * p.se);
    const x = p.offset;
    const x2 = x * x;
    s11 += w * x2;
    s12 += w * x * x2;
    s22 += w * x2 * x2;
    t1 += w * x * p.elo;
    t2 += w * x2 * p.elo;
  }
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-12) return { b: 0, c: 0, optimum: null, gainAtOptimum: null };
  const b = (t1 * s22 - t2 * s12) / det;
  const c = (s11 * t2 - s12 * t1) / det;
  if (c >= 0) return { b, c, optimum: null, gainAtOptimum: null };
  const optimum = -b / (2 * c);
  return { b, c, optimum, gainAtOptimum: b * optimum + c * optimum * optimum };
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Ajustement + intervalle bootstrap du décalage optimal. */
export function estimateOptimum(points: ArenaPoint[], samples = 4000, seed = 12345): ArenaEstimate {
  const fit = fitParabola(points);
  let s = seed >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const maxAbs = Math.max(...points.map((p) => Math.abs(p.offset)));
  const lim = 2 * maxAbs;
  const opts: number[] = [];
  let concave = 0;
  for (let k = 0; k < samples; k++) {
    const pts = points.map((p) => ({ ...p, elo: p.elo + p.se * gaussian(rand) }));
    const f = fitParabola(pts);
    if (f.optimum !== null) {
      concave++;
      opts.push(Math.max(-lim, Math.min(lim, f.optimum)));
    } else {
      // Parabole convexe ou plate : l'optimum est hors de la plage, du côté de la pente.
      opts.push(f.b >= 0 ? lim : -lim);
    }
  }
  opts.sort((a, b) => a - b);
  const q = (x: number) => opts[Math.min(opts.length - 1, Math.max(0, Math.floor(x * opts.length)))];
  return { ...fit, low: q(0.025), high: q(0.975), concaveShare: concave / samples };
}
