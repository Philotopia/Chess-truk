// Réglage automatique des coefficients (méthode Texel) — sans Stockfish.
//
// Principe : l'évaluation est (presque) linéaire en ses paramètres. À partir de la trace explicable
// (evaluateDetailed), chaque position est convertie en un vecteur creux de « caractéristiques »
// (paramètre, coefficient MG, coefficient EG) + une constante (termes figés). On minimise ensuite
// l'erreur quadratique entre le résultat réel des parties (1 / ½ / 0) et sigmoïde(K × éval).
//
// RÈGLE DU PROJET (contrainte demandée) : la valeur des pions croît fortement avec leur avancement.
//   - la table d'avancement des pions (pawnAdvancement) est FIGÉE : elle n'est jamais réglée ;
//   - la PST des pions est figée à sa valeur (0 par défaut) : elle ne peut pas compenser l'avancement ;
//   - les bonus de pion passé sont contraints ≥ 0 et croissants avec la rangée ;
//   - la valeur du pion (100) sert d'unité et reste fixe.

import type { Position } from '../core/position';
import { KNIGHT, PAWN, pieceType } from '../core/types';
import { MAX_PHASE, evaluateDetailed } from './evaluate';
import { type EvalParams, PIECE_KEYS, getByPath, setByPath } from './params';

export interface TuneParam {
  path: string;
  min: number;
  max: number;
}

const PK = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

function buildSpec(): TuneParam[] {
  const out: TuneParam[] = [];
  const add = (path: string, min: number, max: number) => out.push({ path, min, max });
  for (const k of ['knight', 'bishop', 'rook', 'queen']) add(`pieceValues.${k}`, 150, 1400);
  for (const p of PIECE_KEYS) {
    if (p === 'pawn') continue; // figé (règle des pions)
    for (const ph of ['mg', 'eg']) for (let i = 0; i < 64; i++) add(`psqt.${p}.${ph}.${i}`, -200, 200);
  }
  for (const ph of ['mg', 'eg']) for (let r = 1; r <= 6; r++) add(`passedPawn.${ph}.${r}`, 0, 300);
  const s2 = [
    'protectedPassed',
    'connectedPawn',
    'isolatedPawn',
    'doubledPawn',
    'backwardPawn',
    'mobility.knight',
    'mobility.bishop',
    'mobility.rook',
    'mobility.queen',
    'bishopPair',
    'rookOpenFile',
    'rookSemiOpenFile',
    'rookOnSeventh',
    'outpost.knight',
    'outpost.bishop',
    'threats.attackedByPawn',
    'threats.hanging',
    'tempo',
  ];
  for (const k of s2) for (const ph of ['mg', 'eg']) add(`${k}.${ph}`, -150, 150);
  for (const k of [
    'kingPasserProximity',
    'center.pawnOccupation',
    'center.attack',
    'space',
    'kingSafety.shieldRank1',
    'kingSafety.shieldRank2',
    'kingSafety.semiOpenFile',
    'kingSafety.openFile',
    'development.undevelopedMinor',
    'mopUp.edge',
    'mopUp.proximity',
  ])
    add(k, -100, 100);
  add('kingSafety.attackScale', 0, 300);
  return out;
}

export const TUNE_SPEC: TuneParam[] = buildSpec();
const INDEX = new Map(TUNE_SPEC.map((p, i) => [p.path, i]));

export function paramIndex(path: string): number {
  const i = INDEX.get(path);
  if (i === undefined) throw new Error(`Paramètre non réglable : ${path}`);
  return i;
}

export function readVector(p: EvalParams): Float64Array {
  const v = new Float64Array(TUNE_SPEC.length);
  TUNE_SPEC.forEach((s, i) => (v[i] = Number(getByPath(p, s.path))));
  return v;
}

export function writeVector(p: EvalParams, v: Float64Array, round = true): void {
  TUNE_SPEC.forEach((s, i) => setByPath(p, s.path, round ? Math.round(v[i]) : v[i]));
}

/** Projection sur les contraintes : bornes + pions passés ≥ 0 et croissants. */
export function project(v: Float64Array): void {
  TUNE_SPEC.forEach((s, i) => {
    if (v[i] < s.min) v[i] = s.min;
    if (v[i] > s.max) v[i] = s.max;
  });
  for (const ph of ['mg', 'eg']) {
    let prev = 0;
    for (let r = 1; r <= 6; r++) {
      const i = paramIndex(`passedPawn.${ph}.${r}`);
      if (v[i] < prev) v[i] = prev;
      prev = v[i];
    }
  }
}

export interface Features {
  idx: Int32Array;
  mg: Float32Array;
  eg: Float32Array;
  constant: number; // contribution figée, déjà interpolée
  phase: number;
}

/**
 * Décompose l'évaluation d'une position en caractéristiques linéaires.
 * eval ≈ Σ v[idx]·(mg·phase + eg·(24−phase))/24 + constant (point de vue des blancs).
 */
export function extractFeatures(pos: Position, params: EvalParams): Features {
  const d = evaluateDetailed(pos, params);
  const ph = d.phase;
  const acc = new Map<number, [number, number]>();
  let constant = 0;
  const push = (path: string, cm: number, ce: number) => {
    const i = paramIndex(path);
    const a = acc.get(i);
    if (a) {
      a[0] += cm;
      a[1] += ce;
    } else acc.set(i, [cm, ce]);
  };
  const interp = (mg: number, eg: number) => (mg * ph + eg * (MAX_PHASE - ph)) / MAX_PHASE;
  for (const e of d.entries) {
    const sg = e.color === 0 ? 1 : -1;
    const n = e.n ?? 0;
    const pt = e.sq >= 0 ? pieceType(pos.board[e.sq]) : 0;
    switch (e.key) {
      case 'pieces': {
        const t = Math.floor(n / 100);
        const c = n % 100;
        if (t === PAWN) constant += sg * interp(e.mg, e.eg);
        else push(`pieceValues.${PK[t]}`, sg * c, sg * c);
        break;
      }
      case 'pst': {
        if (pt === PAWN) {
          constant += sg * interp(e.mg, e.eg);
          break;
        }
        const f = e.sq & 7;
        const r = e.sq >> 4;
        const i = e.color === 0 ? (7 - r) * 8 + f : r * 8 + f;
        push(`psqt.${PK[pt]}.mg.${i}`, sg, 0);
        push(`psqt.${PK[pt]}.eg.${i}`, 0, sg);
        break;
      }
      case 'mob': {
        const base = params.mobility.baseline[PK[pt] as 'knight'];
        push(`mobility.${PK[pt]}.mg`, sg * (n - base), 0);
        push(`mobility.${PK[pt]}.eg`, 0, sg * (n - base));
        break;
      }
      case 'doubled':
      case 'isolated':
      case 'backward':
      case 'connected':
      case 'protectedPassed': {
        const key = { doubled: 'doubledPawn', isolated: 'isolatedPawn', backward: 'backwardPawn', connected: 'connectedPawn', protectedPassed: 'protectedPassed' }[e.key];
        push(`${key}.mg`, sg, 0);
        push(`${key}.eg`, 0, sg);
        break;
      }
      case 'passed':
        push(`passedPawn.mg.${n - 1}`, sg, 0);
        push(`passedPawn.eg.${n - 1}`, 0, sg);
        break;
      case 'advance':
        constant += sg * interp(e.mg, e.eg); // figé (règle des pions)
        break;
      case 'kingProximity':
        push('kingPasserProximity', 0, sg * n);
        break;
      case 'centerPawn':
        push('center.pawnOccupation', sg * n, 0);
        break;
      case 'centerAttack':
        push('center.attack', sg * n, 0);
        break;
      case 'space':
        push('space', sg * n, 0);
        break;
      case 'shield':
        push('kingSafety.shieldRank1', sg * (n >> 4), 0);
        push('kingSafety.shieldRank2', sg * (n & 15), 0);
        break;
      case 'openFile':
        push('kingSafety.openFile', sg * n, 0);
        break;
      case 'semiOpenFile':
        push('kingSafety.semiOpenFile', sg * n, 0);
        break;
      case 'kingPressure': {
        const u = n % 1000;
        const raw = (u * u * params.kingSafety.attackScale) / 100;
        if (raw < params.kingSafety.attackCap) push('kingSafety.attackScale', -sg * ((u * u) / 100), 0);
        else constant += sg * interp(e.mg, e.eg);
        break;
      }
      case 'pair':
        push('bishopPair.mg', sg, 0);
        push('bishopPair.eg', 0, sg);
        break;
      case 'rookOpen':
      case 'rookSemiOpen':
      case 'rookSeventh': {
        const key = { rookOpen: 'rookOpenFile', rookSemiOpen: 'rookSemiOpenFile', rookSeventh: 'rookOnSeventh' }[e.key];
        push(`${key}.mg`, sg, 0);
        push(`${key}.eg`, 0, sg);
        break;
      }
      case 'outpost': {
        const key = pt === KNIGHT ? 'outpost.knight' : 'outpost.bishop';
        push(`${key}.mg`, sg, 0);
        push(`${key}.eg`, 0, sg);
        break;
      }
      case 'undeveloped':
        push('development.undevelopedMinor', sg, 0);
        break;
      case 'attackedByPawn':
      case 'hanging':
        push(`threats.${e.key}.mg`, sg, 0);
        push(`threats.${e.key}.eg`, 0, sg);
        break;
      case 'tempo':
        push('tempo.mg', sg, 0);
        push('tempo.eg', 0, sg);
        break;
      case 'mopUpEdge':
        push('mopUp.edge', 0, sg * n);
        break;
      case 'mopUpKings':
        push('mopUp.proximity', 0, sg * n);
        break;
      default:
        constant += sg * interp(e.mg, e.eg);
    }
  }
  // Les paramètres « MG seulement » / « EG seulement » ne contribuent qu'à leur phase.
  const idx = new Int32Array(acc.size);
  const mg = new Float32Array(acc.size);
  const eg = new Float32Array(acc.size);
  let k = 0;
  for (const [i, [cm, ce]] of acc) {
    idx[k] = i;
    mg[k] = cm;
    eg[k] = ce;
    k++;
  }
  return { idx, mg, eg, constant, phase: ph };
}

/** Évaluation linéaire reconstituée (point de vue des blancs). */
export function linearEval(f: Features, v: Float64Array): number {
  let s = f.constant;
  const ph = f.phase;
  for (let k = 0; k < f.idx.length; k++) {
    const w = v[f.idx[k]];
    s += (w * (f.mg[k] * ph + f.eg[k] * (MAX_PHASE - ph))) / MAX_PHASE;
  }
  return s;
}

const sigmoid = (x: number, K: number) => 1 / (1 + Math.pow(10, (-K * x) / 400));

export interface Sample {
  f: Features;
  /** Résultat du point de vue des blancs : 1, 0.5, 0. */
  r: number;
}

export function meanError(samples: Sample[], v: Float64Array, K: number): number {
  let e = 0;
  for (const s of samples) {
    const d = s.r - sigmoid(linearEval(s.f, v), K);
    e += d * d;
  }
  return e / samples.length;
}

/** Recherche de K minimisant l'erreur (paramètres actuels). */
export function fitK(samples: Sample[], v: Float64Array): number {
  let lo = 0.1;
  let hi = 3;
  for (let it = 0; it < 40; it++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (meanError(samples, v, a) < meanError(samples, v, b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/** Une époque d'Adam (mini-lots) ; renvoie l'erreur moyenne. Les paramètres figés n'apparaissent pas dans v. */
export function adamEpoch(
  samples: Sample[],
  v: Float64Array,
  K: number,
  state: { m: Float64Array; s: Float64Array; t: number },
  lr = 1,
  batch = 4096,
): void {
  const n = v.length;
  const grad = new Float64Array(n);
  const c = (Math.LN10 * K) / 400;
  for (let b0 = 0; b0 < samples.length; b0 += batch) {
    grad.fill(0);
    const end = Math.min(samples.length, b0 + batch);
    for (let i = b0; i < end; i++) {
      const s = samples[i];
      const f = s.f;
      const sig = sigmoid(linearEval(f, v), K);
      const g = -2 * (s.r - sig) * sig * (1 - sig) * c;
      const ph = f.phase;
      for (let k = 0; k < f.idx.length; k++) grad[f.idx[k]] += (g * (f.mg[k] * ph + f.eg[k] * (MAX_PHASE - ph))) / MAX_PHASE;
    }
    const m = end - b0;
    state.t++;
    const b1 = 0.9;
    const b2 = 0.999;
    for (let j = 0; j < n; j++) {
      const gj = grad[j] / m;
      state.m[j] = b1 * state.m[j] + (1 - b1) * gj;
      state.s[j] = b2 * state.s[j] + (1 - b2) * gj * gj;
      const mh = state.m[j] / (1 - Math.pow(b1, state.t));
      const sh = state.s[j] / (1 - Math.pow(b2, state.t));
      v[j] -= (lr * mh) / (Math.sqrt(sh) + 1e-8);
    }
    project(v);
  }
}

