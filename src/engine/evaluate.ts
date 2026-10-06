// Fonction d'évaluation explicable.
//
// Chaque contribution passe par une composante nommée (EVAL_TERMS) et, si une trace est demandée,
// est enregistrée avec la couleur, la case et une clé décrivant l'heuristique. Le total renvoyé par
// evaluate() est exactement la somme des composantes interpolées : aucune contribution n'échappe
// à la décomposition (vérifié par les tests).
//
// Toutes les valeurs sont en centipawns, du point de vue des blancs.
// Interpolation : score = (MG × phase + EG × (24 − phase)) / 24, phase ∈ [0, 24]
// calculée à partir du matériel restant (C/F = 1, T = 2, D = 4).

import { BISHOP_DIRS, KING_OFFSETS, KNIGHT_OFFSETS, type Position, ROOK_DIRS } from '../core/position';
import { BISHOP, BLACK, type Color, EMPTY, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from '../core/types';
import { EVAL_TERMS, type EvalParams, type EvalTerm, PIECE_KEYS } from './params';

export const T_MATERIAL = 0;
export const T_PSQT = 1;
export const T_MOBILITY = 2;
export const T_PAWN_STRUCTURE = 3;
export const T_PAWN_ADVANCEMENT = 4;
export const T_PASSED = 5;
export const T_CENTER = 6;
export const T_SPACE = 7;
export const T_KING_SAFETY = 8;
export const T_KING_ENDGAME = 9;
export const T_BISHOP_PAIR = 10;
export const T_ROOKS = 11;
export const T_OUTPOSTS = 12;
export const T_DEVELOPMENT = 13;
export const T_THREATS = 14;
export const T_TEMPO = 15;
export const T_MOPUP = 16;
const NT = EVAL_TERMS.length;

export const MAX_PHASE = 24;

export interface EvalTraceEntry {
  term: EvalTerm;
  color: Color;
  /** Case 0x88 concernée, -1 si globale. */
  sq: number;
  /** Clé de l'heuristique (voir TRACE_KEY_LABELS). */
  key: string;
  /** Valeurs brutes du point de vue de `color` (positif = bon pour ce camp). */
  mg: number;
  eg: number;
  /** Information complémentaire (nombre de cases, d'unités…). */
  n?: number;
}

export interface EvalTermResult {
  mg: number;
  eg: number;
  /** Valeur interpolée (non arrondie), point de vue des blancs. */
  value: number;
}

export interface EvalBreakdown {
  /** Total arrondi, point de vue des blancs. */
  total: number;
  /** Total non arrondi (somme exacte des composantes). */
  exact: number;
  phase: number;
  terms: Record<EvalTerm, EvalTermResult>;
  entries: EvalTraceEntry[];
  sideToMove: Color;
}

export const TRACE_KEY_LABELS: Record<string, string> = {
  pieces: 'pièces',
  pst: 'placement',
  mob: 'mobilité',
  doubled: 'pion doublé',
  isolated: 'pion isolé',
  backward: 'pion arriéré',
  connected: 'pion connecté',
  advance: 'avancement',
  passed: 'pion passé',
  protectedPassed: 'pion passé protégé',
  kingProximity: 'proximité des rois',
  centerPawn: 'pion central',
  centerAttack: 'attaques du centre',
  space: 'espace',
  shield: 'bouclier de pions',
  openFile: 'colonne ouverte près du roi',
  semiOpenFile: 'colonne semi-ouverte près du roi',
  kingPressure: 'pression sur le roi',
  pair: 'paire de fous',
  rookOpen: 'colonne ouverte',
  rookSemiOpen: 'colonne semi-ouverte',
  rookSeventh: '7e rangée',
  outpost: 'avant-poste',
  undeveloped: 'non développé',
  attackedByPawn: 'attaqué par un pion',
  hanging: 'pièce en prise',
  tempo: 'trait',
  mopUpEdge: 'roi adverse repoussé au bord',
  mopUpKings: 'rapprochement des rois',
};

// --- Paramètres compilés en tableaux plats (recalculés si l'objet change) ---

interface Compiled {
  value: Int32Array; // par type 0..6
  pstMg: Int32Array; // pièce (0..15) * 128 + case
  pstEg: Int32Array;
  adv: Int32Array; // couleur * 8 + rangée absolue
  passedMg: Int32Array;
  passedEg: Int32Array;
  on: Uint8Array;
  p: EvalParams;
}

const compiledCache = new WeakMap<EvalParams, Compiled>();

function compile(p: EvalParams): Compiled {
  const value = new Int32Array(7);
  value[PAWN] = p.pieceValues.pawn;
  value[KNIGHT] = p.pieceValues.knight;
  value[BISHOP] = p.pieceValues.bishop;
  value[ROOK] = p.pieceValues.rook;
  value[QUEEN] = p.pieceValues.queen;
  value[KING] = 0;
  const pstMg = new Int32Array(16 * 128);
  const pstEg = new Int32Array(16 * 128);
  for (let t = 1; t <= 6; t++) {
    const tbl = p.psqt[PIECE_KEYS[t - 1]];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const f = sq & 7;
      const r = sq >> 4;
      const wi = (7 - r) * 8 + f; // blancs : ordre visuel
      const bi = r * 8 + f; // noirs : miroir vertical
      pstMg[t * 128 + sq] = tbl.mg[wi] | 0;
      pstEg[t * 128 + sq] = tbl.eg[wi] | 0;
      pstMg[(t | 8) * 128 + sq] = tbl.mg[bi] | 0;
      pstEg[(t | 8) * 128 + sq] = tbl.eg[bi] | 0;
    }
  }
  const adv = new Int32Array(16);
  const passedMg = new Int32Array(16);
  const passedEg = new Int32Array(16);
  for (let r = 0; r < 8; r++) {
    adv[r] = p.pawnAdvancement[r] | 0;
    adv[8 + r] = p.pawnAdvancement[7 - r] | 0;
    passedMg[r] = p.passedPawn.mg[r] | 0;
    passedMg[8 + r] = p.passedPawn.mg[7 - r] | 0;
    passedEg[r] = p.passedPawn.eg[r] | 0;
    passedEg[8 + r] = p.passedPawn.eg[7 - r] | 0;
  }
  const on = new Uint8Array(NT);
  EVAL_TERMS.forEach((t, i) => (on[i] = p.enabled[t] === false ? 0 : 1));
  return { value, pstMg, pstEg, adv, passedMg, passedEg, on, p };
}

function getCompiled(p: EvalParams): Compiled {
  let c = compiledCache.get(p);
  if (!c) {
    c = compile(p);
    compiledCache.set(p, c);
  }
  return c;
}

/** À appeler si un objet de paramètres est modifié en place. */
export function invalidateEvalCache(p: EvalParams): void {
  compiledCache.delete(p);
}

// --- Tampons de travail (aucune allocation dans la boucle de recherche) ---

const pawnAtt = [new Uint8Array(128), new Uint8Array(128)];
const att = [new Uint8Array(128), new Uint8Array(128)];
const zone = [new Uint8Array(128), new Uint8Array(128)]; // zone autour du roi de chaque camp
const fileCount = [new Int8Array(8), new Int8Array(8)];
const minRank = [new Int8Array(8), new Int8Array(8)];
const maxRank = [new Int8Array(8), new Int8Array(8)];
const pieceSq = new Int16Array(64);
const accMg = new Int32Array(NT);
const accEg = new Int32Array(NT);
const kAttackers = new Int32Array(2); // attaquants du roi de la couleur indexée
const kUnits = new Int32Array(2);

const CENTER = [0x33, 0x34, 0x43, 0x44];

let trace: EvalTraceEntry[] | null = null;
/** Trace aussi les contributions nulles (extraction de caractéristiques pour le réglage). */
let traceAll = false;

function add(term: number, color: Color, mg: number, eg: number, sq: number, key: string, n?: number): void {
  if (color === WHITE) {
    accMg[term] += mg;
    accEg[term] += eg;
  } else {
    accMg[term] -= mg;
    accEg[term] -= eg;
  }
  if (trace !== null && (mg !== 0 || eg !== 0 || traceAll)) {
    trace.push({ term: EVAL_TERMS[term], color, sq, key, mg, eg, n });
  }
}

function dist(a: number, b: number): number {
  return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
}

export function gamePhase(pos: Position): number {
  const c = pos.counts;
  const ph =
    c[KNIGHT] + c[KNIGHT | 8] + c[BISHOP] + c[BISHOP | 8] + 2 * (c[ROOK] + c[ROOK | 8]) + 4 * (c[QUEEN] + c[QUEEN | 8]);
  return ph > MAX_PHASE ? MAX_PHASE : ph;
}

function run(pos: Position, params: EvalParams): number {
  const C = getCompiled(params);
  const P = C.p;
  const on = C.on;
  const b = pos.board;
  accMg.fill(0);
  accEg.fill(0);
  pawnAtt[0].fill(0);
  pawnAtt[1].fill(0);
  att[0].fill(0);
  att[1].fill(0);
  zone[0].fill(0);
  zone[1].fill(0);
  for (let c = 0; c < 2; c++) {
    fileCount[c].fill(0);
    minRank[c].fill(8);
    maxRank[c].fill(-1);
  }
  kAttackers[0] = kAttackers[1] = 0;
  kUnits[0] = kUnits[1] = 0;

  // Passe A : matériel, PST, informations de pions, attaques de pions.
  let nPieces = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (p === EMPTY) continue;
    const t = p & 7;
    const c = (p >> 3) as Color;
    if (on[T_PSQT]) {
      const mg = C.pstMg[p * 128 + sq];
      const eg = C.pstEg[p * 128 + sq];
      if (mg !== 0 || eg !== 0 || traceAll) add(T_PSQT, c, mg, eg, sq, 'pst');
    }
    if (t === PAWN) {
      const f = sq & 7;
      const r = sq >> 4;
      fileCount[c][f]++;
      if (r < minRank[c][f]) minRank[c][f] = r;
      if (r > maxRank[c][f]) maxRank[c][f] = r;
      const fwd = c === WHITE ? 16 : -16;
      let s = sq + fwd - 1;
      if (!(s & 0x88)) {
        pawnAtt[c][s]++;
        att[c][s]++;
      }
      s = sq + fwd + 1;
      if (!(s & 0x88)) {
        pawnAtt[c][s]++;
        att[c][s]++;
      }
    } else if (t !== KING) {
      pieceSq[nPieces++] = sq;
    }
  }

  if (on[T_MATERIAL]) {
    const cnt = pos.counts;
    for (let t = PAWN; t <= QUEEN; t++) {
      if (cnt[t]) add(T_MATERIAL, WHITE, cnt[t] * C.value[t], cnt[t] * C.value[t], -1, 'pieces', t * 100 + cnt[t]);
      if (cnt[t | 8])
        add(T_MATERIAL, BLACK, cnt[t | 8] * C.value[t], cnt[t | 8] * C.value[t], -1, 'pieces', t * 100 + cnt[t | 8]);
    }
  }

  // Zones des rois.
  for (let c = 0; c < 2; c++) {
    const k = pos.kingSq[c];
    zone[c][k] = 1;
    for (let i = 0; i < 8; i++) {
      const s = k + KING_OFFSETS[i];
      if (!(s & 0x88)) zone[c][s] = 1;
      // Le roi attaque aussi ses cases voisines.
      if (!(s & 0x88)) att[c][s]++;
    }
  }

  // Passe B : structure de pions, avancement, pions passés.
  const doPawnStruct = on[T_PAWN_STRUCTURE];
  const doAdv = on[T_PAWN_ADVANCEMENT];
  const doPassed = on[T_PASSED];
  const doKingEg = on[T_KING_ENDGAME];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if ((p & 7) !== PAWN) continue;
    const c = (p >> 3) as Color;
    const them = (c ^ 1) as Color;
    const f = sq & 7;
    const r = sq >> 4;
    const rel = c === WHITE ? r : 7 - r;
    if (doAdv) {
      const v = C.adv[c * 8 + r];
      if (v || traceAll) add(T_PAWN_ADVANCEMENT, c, v, v, sq, 'advance', rel + 1);
    }
    // Pion ami devant sur la même colonne ?
    const ownAhead = c === WHITE ? maxRank[c][f] > r : minRank[c][f] < r;
    const fl = f - 1;
    const fr = f + 1;
    const isolated = (fl < 0 || fileCount[c][fl] === 0) && (fr > 7 || fileCount[c][fr] === 0);
    if (doPawnStruct) {
      if (ownAhead) add(T_PAWN_STRUCTURE, c, P.doubledPawn.mg, P.doubledPawn.eg, sq, 'doubled');
      if (isolated) {
        add(T_PAWN_STRUCTURE, c, P.isolatedPawn.mg, P.isolatedPawn.eg, sq, 'isolated');
      } else {
        const ownPawn = p;
        const phalanx = (!((sq - 1) & 0x88) && b[sq - 1] === ownPawn) || (!((sq + 1) & 0x88) && b[sq + 1] === ownPawn);
        const supported = pawnAtt[c][sq] > 0;
        if (phalanx || supported) {
          add(T_PAWN_STRUCTURE, c, P.connectedPawn.mg, P.connectedPawn.eg, sq, 'connected');
        } else {
          // Arriéré : tous les pions des colonnes adjacentes sont plus avancés et la case d'arrêt est contrôlée par un pion adverse.
          let behindOrLevel = false;
          if (c === WHITE) {
            if (fl >= 0 && fileCount[c][fl] && minRank[c][fl] <= r) behindOrLevel = true;
            if (fr <= 7 && fileCount[c][fr] && minRank[c][fr] <= r) behindOrLevel = true;
          } else {
            if (fl >= 0 && fileCount[c][fl] && maxRank[c][fl] >= r) behindOrLevel = true;
            if (fr <= 7 && fileCount[c][fr] && maxRank[c][fr] >= r) behindOrLevel = true;
          }
          const stop = sq + (c === WHITE ? 16 : -16);
          if (!behindOrLevel && !(stop & 0x88) && pawnAtt[them][stop] > 0) {
            add(T_PAWN_STRUCTURE, c, P.backwardPawn.mg, P.backwardPawn.eg, sq, 'backward');
          }
        }
      }
    }
    if ((doPassed || doKingEg) && !ownAhead) {
      // Passé : aucun pion adverse devant sur la colonne ou les colonnes adjacentes.
      let passed = true;
      for (let ff = fl < 0 ? 0 : fl; ff <= (fr > 7 ? 7 : fr); ff++) {
        if (fileCount[them][ff] === 0) continue;
        if (c === WHITE ? maxRank[them][ff] > r : minRank[them][ff] < r) {
          passed = false;
          break;
        }
      }
      if (passed) {
        if (doPassed) {
          add(T_PASSED, c, C.passedMg[c * 8 + r], C.passedEg[c * 8 + r], sq, 'passed', rel + 1);
          if (pawnAtt[c][sq] > 0) add(T_PASSED, c, P.protectedPassed.mg, P.protectedPassed.eg, sq, 'protectedPassed');
        }
        if (doKingEg && rel >= 3) {
          const stop = sq + (c === WHITE ? 16 : -16);
          const dOwn = Math.min(5, dist(pos.kingSq[c], stop));
          const dThem = Math.min(5, dist(pos.kingSq[them], stop));
          const v = P.kingPasserProximity * (dThem - dOwn);
          if (v || (traceAll && dThem !== dOwn)) add(T_KING_ENDGAME, c, 0, v, sq, 'kingProximity', dThem - dOwn);
        }
      }
    }
  }

  // Passe C : pièces (mobilité, attaques, tours, avant-postes).
  const mob = P.mobility;
  const doMob = on[T_MOBILITY];
  const doRooks = on[T_ROOKS];
  const doOutposts = on[T_OUTPOSTS];
  const kw = P.kingSafety.attackWeights;
  for (let i = 0; i < nPieces; i++) {
    const sq = pieceSq[i];
    const p = b[sq];
    const t = p & 7;
    const c = (p >> 3) as Color;
    const them = (c ^ 1) as Color;
    const pa = pawnAtt[them];
    const ac = att[c];
    const ez = zone[them];
    let moves = 0;
    let zoneHits = 0;
    if (t === KNIGHT) {
      for (let k = 0; k < 8; k++) {
        const s = sq + KNIGHT_OFFSETS[k];
        if (s & 0x88) continue;
        ac[s]++;
        if (ez[s]) zoneHits++;
        const o = b[s];
        if ((o === EMPTY || o >> 3 !== c) && pa[s] === 0) moves++;
      }
    } else {
      const dirs = t === BISHOP ? BISHOP_DIRS : t === ROOK ? ROOK_DIRS : KING_OFFSETS;
      for (let k = 0; k < dirs.length; k++) {
        const d = dirs[k];
        let s = sq + d;
        while (!(s & 0x88)) {
          ac[s]++;
          if (ez[s]) zoneHits++;
          const o = b[s];
          if (o === EMPTY) {
            if (pa[s] === 0) moves++;
          } else {
            if (o >> 3 !== c && pa[s] === 0) moves++;
            break;
          }
          s += d;
        }
      }
    }
    if (zoneHits) {
      kAttackers[them]++;
      kUnits[them] += zoneHits * (t === KNIGHT ? kw.knight : t === BISHOP ? kw.bishop : t === ROOK ? kw.rook : kw.queen);
    }
    if (doMob) {
      let w;
      let base;
      if (t === KNIGHT) {
        w = mob.knight;
        base = mob.baseline.knight;
      } else if (t === BISHOP) {
        w = mob.bishop;
        base = mob.baseline.bishop;
      } else if (t === ROOK) {
        w = mob.rook;
        base = mob.baseline.rook;
      } else {
        w = mob.queen;
        base = mob.baseline.queen;
      }
      const d = moves - base;
      if (d !== 0) add(T_MOBILITY, c, d * w.mg, d * w.eg, sq, 'mob', moves);
    }
    const f = sq & 7;
    const r = sq >> 4;
    const rel = c === WHITE ? r : 7 - r;
    if (t === ROOK && doRooks) {
      if (fileCount[c][f] === 0) {
        if (fileCount[them][f] === 0) add(T_ROOKS, c, P.rookOpenFile.mg, P.rookOpenFile.eg, sq, 'rookOpen');
        else add(T_ROOKS, c, P.rookSemiOpenFile.mg, P.rookSemiOpenFile.eg, sq, 'rookSemiOpen');
      }
      if (rel === 6) {
        const kRel = c === WHITE ? pos.kingSq[them] >> 4 : 7 - (pos.kingSq[them] >> 4);
        let pawnsOn7 = false;
        const enemyPawn = PAWN | (them << 3);
        for (let ff = 0; ff < 8; ff++) if (b[r * 16 + ff] === enemyPawn) pawnsOn7 = true;
        if (kRel === 7 || pawnsOn7) add(T_ROOKS, c, P.rookOnSeventh.mg, P.rookOnSeventh.eg, sq, 'rookSeventh');
      }
    }
    if ((t === KNIGHT || t === BISHOP) && doOutposts && rel >= 3 && rel <= 5 && pawnAtt[c][sq] > 0) {
      let safe = true;
      for (const ff of [f - 1, f + 1]) {
        if (ff < 0 || ff > 7 || fileCount[them][ff] === 0) continue;
        if (c === WHITE ? maxRank[them][ff] > r : minRank[them][ff] < r) safe = false;
      }
      if (safe) {
        const s2 = t === KNIGHT ? P.outpost.knight : P.outpost.bishop;
        add(T_OUTPOSTS, c, s2.mg, s2.eg, sq, 'outpost');
      }
    }
  }

  // Passe D : menaces, centre, espace, roi, paire de fous, développement, trait.
  if (on[T_THREATS]) {
    const th = P.threats;
    for (let i = 0; i < nPieces; i++) {
      const sq = pieceSq[i];
      const c = (b[sq] >> 3) as Color;
      const them = c ^ 1;
      if (pawnAtt[them][sq] > 0) add(T_THREATS, c, th.attackedByPawn.mg, th.attackedByPawn.eg, sq, 'attackedByPawn');
      else if (att[them][sq] > 0 && att[c][sq] === 0) add(T_THREATS, c, th.hanging.mg, th.hanging.eg, sq, 'hanging');
    }
  }

  if (on[T_CENTER]) {
    for (let c = 0 as Color; c < 2; c = (c + 1) as Color) {
      let pawns = 0;
      let attacks = 0;
      for (let i = 0; i < 4; i++) {
        const s = CENTER[i];
        if (b[s] === (PAWN | (c << 3))) pawns++;
        attacks += att[c][s];
      }
      if (pawns) add(T_CENTER, c, pawns * P.center.pawnOccupation, 0, -1, 'centerPawn', pawns);
      if (attacks) add(T_CENTER, c, attacks * P.center.attack, 0, -1, 'centerAttack', attacks);
    }
  }

  if (on[T_SPACE] && (P.space !== 0 || traceAll)) {
    for (let c = 0 as Color; c < 2; c = (c + 1) as Color) {
      const them = c ^ 1;
      const ownPawn = PAWN | (c << 3);
      let n = 0;
      for (let rel = 1; rel <= 3; rel++) {
        const r = c === WHITE ? rel : 7 - rel;
        for (let f = 2; f <= 5; f++) {
          const s = r * 16 + f;
          if (b[s] === ownPawn || pawnAtt[them][s] > 0) continue;
          n++;
          // Case située derrière un pion ami (jusqu'à 3 rangées) : comptée double.
          const step = c === WHITE ? 16 : -16;
          for (let k = 1; k <= 3; k++) {
            const s2 = s + k * step;
            if (s2 & 0x88) break;
            if (b[s2] === ownPawn) {
              n++;
              break;
            }
          }
        }
      }
      if (n) add(T_SPACE, c, n * P.space, 0, -1, 'space', n);
    }
  }

  if (on[T_KING_SAFETY]) {
    const ks = P.kingSafety;
    for (let c = 0 as Color; c < 2; c = (c + 1) as Color) {
      const them = (c ^ 1) as Color;
      const k = pos.kingSq[c];
      const kf = k & 7;
      const kr = k >> 4;
      const rel = c === WHITE ? kr : 7 - kr;
      const fwd = c === WHITE ? 16 : -16;
      const ownPawn = PAWN | (c << 3);
      let n1 = 0;
      let n2 = 0;
      let open = 0;
      let semi = 0;
      for (let f = kf - 1; f <= kf + 1; f++) {
        if (f < 0 || f > 7) continue;
        if (rel <= 1) {
          const s1 = k + fwd + (f - kf);
          const s2 = s1 + fwd;
          if (!(s1 & 0x88) && b[s1] === ownPawn) n1++;
          else if (!(s2 & 0x88) && b[s2] === ownPawn) n2++;
        }
        if (fileCount[c][f] === 0) {
          if (fileCount[them][f] === 0) open++;
          else semi++;
        }
      }
      const shield = n1 * ks.shieldRank1 + n2 * ks.shieldRank2;
      if (shield || (traceAll && n1 + n2 > 0)) add(T_KING_SAFETY, c, shield, 0, k, 'shield', n1 * 16 + n2);
      if (open) add(T_KING_SAFETY, c, open * ks.openFile, 0, k, 'openFile', open);
      if (semi) add(T_KING_SAFETY, c, semi * ks.semiOpenFile, 0, k, 'semiOpenFile', semi);
      if (kAttackers[c] >= ks.minAttackers && kUnits[c] > 0) {
        const u = kUnits[c];
        const pen = Math.min(ks.attackCap, Math.round((u * u * ks.attackScale) / 100));
        if (pen || traceAll) add(T_KING_SAFETY, c, -pen, 0, k, 'kingPressure', kAttackers[c] * 1000 + u);
      }
    }
  }

  if (on[T_BISHOP_PAIR]) {
    if (pos.counts[BISHOP] >= 2) add(T_BISHOP_PAIR, WHITE, P.bishopPair.mg, P.bishopPair.eg, -1, 'pair');
    if (pos.counts[BISHOP | 8] >= 2) add(T_BISHOP_PAIR, BLACK, P.bishopPair.mg, P.bishopPair.eg, -1, 'pair');
  }

  if (on[T_DEVELOPMENT] && (P.development.undevelopedMinor !== 0 || traceAll)) {
    const u = P.development.undevelopedMinor;
    if (b[0x01] === KNIGHT) add(T_DEVELOPMENT, WHITE, u, 0, 0x01, 'undeveloped');
    if (b[0x06] === KNIGHT) add(T_DEVELOPMENT, WHITE, u, 0, 0x06, 'undeveloped');
    if (b[0x02] === BISHOP) add(T_DEVELOPMENT, WHITE, u, 0, 0x02, 'undeveloped');
    if (b[0x05] === BISHOP) add(T_DEVELOPMENT, WHITE, u, 0, 0x05, 'undeveloped');
    if (b[0x71] === (KNIGHT | 8)) add(T_DEVELOPMENT, BLACK, u, 0, 0x71, 'undeveloped');
    if (b[0x76] === (KNIGHT | 8)) add(T_DEVELOPMENT, BLACK, u, 0, 0x76, 'undeveloped');
    if (b[0x72] === (BISHOP | 8)) add(T_DEVELOPMENT, BLACK, u, 0, 0x72, 'undeveloped');
    if (b[0x75] === (BISHOP | 8)) add(T_DEVELOPMENT, BLACK, u, 0, 0x75, 'undeveloped');
  }

  if (on[T_TEMPO]) add(T_TEMPO, pos.side, P.tempo.mg, P.tempo.eg, -1, 'tempo');

  if (on[T_MOPUP]) {
    const cnt = pos.counts;
    const v = C.value;
    let wm = 0;
    let bm = 0;
    for (let t = PAWN; t <= QUEEN; t++) {
      wm += cnt[t] * v[t];
      bm += cnt[t | 8] * v[t];
    }
    const strong: Color = wm >= bm ? WHITE : BLACK;
    const weak = (strong ^ 1) as Color;
    if (Math.abs(wm - bm) >= P.mopUp.minAdvantage && cnt[PAWN | (weak << 3)] === 0) {
      const wk = pos.kingSq[weak];
      const sk = pos.kingSq[strong];
      const f = wk & 7;
      const r = wk >> 4;
      const cmd = Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4); // 0 (centre) … 6 (coin)
      const md = Math.abs((wk & 7) - (sk & 7)) + Math.abs((wk >> 4) - (sk >> 4));
      if (cmd) add(T_MOPUP, strong, 0, P.mopUp.edge * cmd, wk, 'mopUpEdge', cmd);
      if (md < 14) add(T_MOPUP, strong, 0, P.mopUp.proximity * (14 - md), sk, 'mopUpKings', 14 - md);
    }
  }

  const phase = gamePhase(pos);
  let mg = 0;
  let eg = 0;
  for (let i = 0; i < NT; i++) {
    mg += accMg[i];
    eg += accEg[i];
  }
  return (mg * phase + eg * (MAX_PHASE - phase)) / MAX_PHASE;
}

/** Arrondi symétrique (garantit eval(miroir) = −eval). */
function roundSym(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Évaluation rapide (centipawns, point de vue des blancs). */
export function evaluate(pos: Position, params: EvalParams): number {
  trace = null;
  return roundSym(run(pos, params));
}

/** Évaluation du point de vue du camp au trait (utilisée par la recherche negamax). */
export function evaluateStm(pos: Position, params: EvalParams): number {
  trace = null;
  const v = roundSym(run(pos, params));
  return pos.side === WHITE ? v : -v;
}

/** Évaluation détaillée : composantes et contributions élémentaires (allTerms : inclure les contributions nulles). */
export function evaluateDetailed(pos: Position, params: EvalParams, allTerms = false): EvalBreakdown {
  const entries: EvalTraceEntry[] = [];
  trace = entries;
  traceAll = allTerms;
  let exact: number;
  try {
    exact = run(pos, params);
  } finally {
    trace = null;
    traceAll = false;
  }
  const phase = gamePhase(pos);
  const terms = {} as Record<EvalTerm, EvalTermResult>;
  EVAL_TERMS.forEach((t, i) => {
    terms[t] = { mg: accMg[i], eg: accEg[i], value: (accMg[i] * phase + accEg[i] * (MAX_PHASE - phase)) / MAX_PHASE };
  });
  return { total: roundSym(exact), exact, phase, terms, entries, sideToMove: pos.side };
}

/** Valeur interpolée d'une contribution, point de vue de son camp. */
export function entryValue(e: EvalTraceEntry, phase: number): number {
  return (e.mg * phase + e.eg * (MAX_PHASE - phase)) / MAX_PHASE;
}
