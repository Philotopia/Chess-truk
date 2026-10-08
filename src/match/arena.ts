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

export interface FreeFit {
  /** Elo(d) ≈ a + b·d + c·d² */
  a: number;
  b: number;
  c: number;
  optimum: number | null;
}

/** Moindres carrés pondérés de y = a + b·x + c·x² (référence mesurée comme les autres points). */
export function fitParabolaFree(points: { offset: number; elo: number; se: number }[]): FreeFit {
  // Système normal 3×3.
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  for (const p of points) {
    const w = 1 / (p.se * p.se);
    const f = [1, p.offset, p.offset * p.offset];
    for (let i = 0; i < 3; i++) {
      v[i] += w * f[i] * p.elo;
      for (let j = 0; j < 3; j++) M[i][j] += w * f[i] * f[j];
    }
  }
  // Élimination de Gauss.
  const A = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]];
    if (Math.abs(A[i][i]) < 1e-15) return { a: 0, b: 0, c: 0, optimum: null };
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
    }
  }
  const a = A[0][3] / A[0][0];
  const b = A[1][3] / A[1][1];
  const c = A[2][3] / A[2][2];
  return { a, b, c, optimum: c < 0 ? -b / (2 * c) : null };
}

/** Optimum (parabole libre) et intervalle bootstrap. */
export function estimateOptimumFree(points: ArenaPoint[], samples = 4000, seed = 12345): FreeFit & { low: number; high: number; concaveShare: number } {
  const fit = fitParabolaFree(points);
  let s = seed >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const lim = 2 * Math.max(...points.map((p) => Math.abs(p.offset)));
  const opts: number[] = [];
  let concave = 0;
  for (let k = 0; k < samples; k++) {
    const f = fitParabolaFree(points.map((p) => ({ ...p, elo: p.elo + p.se * gaussian(rand) })));
    if (f.optimum !== null) {
      concave++;
      opts.push(Math.max(-lim, Math.min(lim, f.optimum)));
    } else opts.push(f.b >= 0 ? lim : -lim);
  }
  opts.sort((x, y) => x - y);
  const q = (x: number) => opts[Math.min(opts.length - 1, Math.max(0, Math.floor(x * opts.length)))];
  return { ...fit, low: q(0.025), high: q(0.975), concaveShare: concave / samples };
}
