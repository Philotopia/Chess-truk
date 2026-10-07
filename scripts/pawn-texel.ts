// Estimation statistique (méthode Texel) de la valeur des pions selon leur case (rangée et colonne).
// Données : positions de parties Truk contre Truk (results/texel/*.txt), aucun Stockfish.
// Tout le reste de l'évaluation est figé ; seule la contribution « position des pions » est réestimée.
// Usage : npm run pawn-texel [-- --max 600000 --out reports/pawn-values-texel.json]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseFen, toFen } from '../src/core/fen';
import { evaluateDetailed } from '../src/engine/evaluate';
import { defaultEngineConfig } from '../src/engine/params';
import { type PawnModel, FILE_NAMES, pawnCells, separableModel, squareModel } from '../src/engine/pawnModel';
import { Searcher } from '../src/engine/search';

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const max = Number(arg('max', '700000'));
const outFile = arg('out', 'reports/pawn-values-texel.json')!;
const cfg = defaultEngineConfig();
const ADV = cfg.eval.pawnAdvancement;

// --- Données ---
const files = readdirSync('results/texel').filter((f) => f.endsWith('.txt')).sort();
const raw: string[] = [];
for (const f of files) for (const l of readFileSync(`results/texel/${f}`, 'utf8').split('\n')) if (l) raw.push(l);
const lines = raw.slice(0, max);
console.log(`${lines.length} positions (${files.length} fichiers)`);

const qs = new Searcher(cfg.eval, { ...cfg.search, useTT: false, qsTT: false, ttSizeMB: 1 });
interface Row {
  rest: number; // évaluation sans la contribution « position des pions » (point de vue blancs)
  cells: Int8Array;
  r: number;
}
const t0 = Date.now();
const rows: Row[] = lines.map((l) => {
  const [fen, r] = l.split(';');
  const pos = parseFen(fen);
  for (const m of qs.quiescencePv(pos)) pos.makeMove(m);
  const leaf = parseFen(toFen(pos));
  const cells = pawnCells(leaf);
  let pawnPart = 0;
  for (let rel = 1; rel <= 6; rel++) for (let f = 0; f < 8; f++) pawnPart += cells[(rel - 1) * 8 + f] * ADV[rel];
  return { rest: evaluateDetailed(leaf, cfg.eval).exact - pawnPart, cells, r: Number(r) };
});
console.log(`positions calmes et décomposition en ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const sig = (x: number, K: number) => 1 / (1 + Math.pow(10, (-K * x) / 400));

interface Fitted {
  params: Float64Array;
  valError: number;
  trainError: number;
}

function fit(model: PawnModel, monotone: boolean, train: Row[], val: Row[], K: number, epochs = 25): Fitted {
  const feats = (rs: Row[]) => rs.map((r) => model.features(r.cells));
  const ft = feats(train);
  const fv = feats(val);
  const p = model.fromAdvancement(ADV);
  const n = model.nParams;
  const m = new Float64Array(n);
  const v = new Float64Array(n);
  let t = 0;
  const c = (Math.LN10 * K) / 400;
  const evalOf = (row: Row, f: Float32Array) => {
    let s = row.rest;
    for (let i = 0; i < n; i++) s += f[i] * p[i];
    return s;
  };
  const err = (rs: Row[], fs: Float32Array[]) => {
    let e = 0;
    for (let i = 0; i < rs.length; i++) {
      const d = rs[i].r - sig(evalOf(rs[i], fs[i]), K);
      e += d * d;
    }
    return e / rs.length;
  };
  const batch = 8192;
  const g = new Float64Array(n);
  for (let ep = 0; ep < epochs; ep++) {
    for (let b0 = 0; b0 < train.length; b0 += batch) {
      g.fill(0);
      const end = Math.min(train.length, b0 + batch);
      for (let i = b0; i < end; i++) {
        const s = sig(evalOf(train[i], ft[i]), K);
        const gi = -2 * (train[i].r - s) * s * (1 - s) * c;
        const f = ft[i];
        for (let k = 0; k < n; k++) if (f[k]) g[k] += gi * f[k];
      }
      t++;
      for (let k = 0; k < n; k++) {
        const gk = g[k] / (end - b0);
        m[k] = 0.9 * m[k] + 0.1 * gk;
        v[k] = 0.999 * v[k] + 0.001 * gk * gk;
        p[k] -= (0.5 * (m[k] / (1 - 0.9 ** t))) / (Math.sqrt(v[k] / (1 - 0.999 ** t)) + 1e-8);
      }
      model.project(p, monotone);
    }
  }
  return { params: p, valError: err(val, fv), trainError: err(train, ft) };
}

// Découpage en blocs contigus (positions d'une même partie restent ensemble) : 10 % validation.
const nVal = Math.floor(rows.length * 0.1);
const val = rows.slice(rows.length - nVal);
const train = rows.slice(0, rows.length - nVal);

// K ajusté sur la table actuelle.
function errCurrent(rs: Row[], K: number) {
  let e = 0;
  for (const row of rs) {
    let s = row.rest;
    for (let rel = 1; rel <= 6; rel++) for (let f = 0; f < 8; f++) s += row.cells[(rel - 1) * 8 + f] * ADV[rel];
    const d = row.r - sig(s, K);
    e += d * d;
  }
  return e / rs.length;
}
let lo = 0.3;
let hi = 2.5;
for (let i = 0; i < 40; i++) {
  const a = lo + (hi - lo) / 3;
  const b = hi - (hi - lo) / 3;
  if (errCurrent(train, a) < errCurrent(train, b)) hi = b;
  else lo = a;
}
const K = (lo + hi) / 2;
const base = { valError: errCurrent(val, K), trainError: errCurrent(train, K) };
console.log(`K = ${K.toFixed(3)} ; table actuelle : validation ${base.valError.toFixed(6)}`);

const results: Record<string, { table: number[][]; valError: number; trainError: number; folds?: number[][][] }> = {};
const show = (name: string, tbl: number[][]) => {
  console.log(`\n${name}`);
  console.log('           ' + FILE_NAMES.map((f) => f.padStart(7)).join(''));
  for (let rel = 6; rel >= 1; rel--) console.log(`  rangée ${rel + 1} ` + tbl[rel - 1].map((x) => x.toFixed(0).padStart(7)).join(''));
};

for (const model of [separableModel, squareModel]) {
  for (const monotone of [false, true]) {
    const name = `${model.kind === 'separable' ? 'rangée + colonne' : 'case par case'}${monotone ? ' (monotone : règle des pions)' : ' (libre)'}`;
    const f = fit(model, monotone, train, val, K);
    const tbl = model.table(f.params);
    // Stabilité : réestimation sur 5 blocs disjoints de l'entraînement.
    const folds: number[][][] = [];
    const fsz = Math.floor(train.length / 5);
    for (let k = 0; k < 5; k++) folds.push(model.table(fit(model, monotone, train.slice(k * fsz, (k + 1) * fsz), val, K, 15).params));
    results[name] = { table: tbl, valError: f.valError, trainError: f.trainError, folds };
    show(`${name} — validation ${f.valError.toFixed(6)} (table actuelle ${base.valError.toFixed(6)})`, tbl);
    const spread = tbl.map((row, i) => row.map((_, s) => {
      const xs = folds.map((t) => t[i][s]);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    }));
    console.log('  écart-type entre 5 blocs : ' + spread.map((r) => r.map((x) => x.toFixed(0)).join('/')).join('  '));
  }
}

mkdirSync('reports', { recursive: true });
writeFileSync(outFile, JSON.stringify({ createdAt: new Date().toISOString(), positions: rows.length, K, current: { table: ADV, ...base }, results }, null, 2));
console.log(`\nÉcrit : ${outFile}`);
