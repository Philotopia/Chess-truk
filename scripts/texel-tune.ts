// Réglage Texel des coefficients d'évaluation sur des positions étiquetées (fichiers de texel-gen).
// Contrainte du projet : avancement des pions figé, PST pions figée, pions passés ≥ 0 et croissants.
// Usage : npm run texel-tune -- --epochs 40 --out configs/truk-tuned.json [--config base.json] [--max 400000]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseFen, toFen } from '../src/core/fen';
import { Searcher } from '../src/engine/search';
import { type EngineConfig, cloneConfig, defaultEngineConfig, diffConfigs, normalizeConfig } from '../src/engine/params';
import { type Sample, TUNE_SPEC, adamEpoch, extractFeatures, fitK, meanError, readVector, writeVector } from '../src/engine/tuning';

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const epochs = Number(arg('epochs', '40'));
const max = Number(arg('max', '500000'));
const lr = Number(arg('lr', '1'));
const out = arg('out', 'configs/truk-tuned.json')!;
const tunePst = argv.includes('--pst');
const lambda = Number(arg('lambda', '0.0005'));
const base: EngineConfig = arg('config') ? normalizeConfig(JSON.parse(readFileSync(arg('config')!, 'utf8'))) : defaultEngineConfig('Truk');

function shuffle<T>(a: T[], seed = 1): T[] {
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const files = readdirSync('results/texel').filter((f) => f.endsWith('.txt'));
let raw: string[] = [];
for (const f of files) for (const l of readFileSync(`results/texel/${f}`, 'utf8').split('\n')) if (l) raw.push(l);
raw = shuffle(raw).slice(0, max);
console.log(`${raw.length} positions (${files.length} fichiers)`);

const params = cloneConfig(base.eval);
// Position calme : bout de la variante de quiescence (méthode Texel usuelle), calculée une fois avec les paramètres de départ.
const qs = new Searcher(base.eval, { ...base.search, useTT: false, qsTT: false, ttSizeMB: 1 });
const t0 = Date.now();
const leaves: { fen: string; r: number }[] = raw.map((l) => {
  const [fen, r] = l.split(';');
  const pos = parseFen(fen);
  for (const m of qs.quiescencePv(pos)) pos.makeMove(m);
  return { fen: toFen(pos), r: Number(r) };
});
console.log(`positions calmes (quiescence) calculées en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
function build(): Sample[] {
  return leaves.map(({ fen, r }) => ({ f: extractFeatures(parseFen(fen), params), r }));
}
let samples = build();
const nVal = Math.floor(samples.length * 0.1);
let val = samples.slice(0, nVal);
let train = samples.slice(nVal);
const v = readVector(params);
const K = fitK(train, v);
const e0 = meanError(train, v, K);
const ev0 = meanError(val, v, K);
console.log(`K = ${K.toFixed(3)} ; erreur initiale entraînement ${e0.toFixed(6)} validation ${ev0.toFixed(6)}`);
const state = { m: new Float64Array(v.length), s: new Float64Array(v.length), t: 0 };
// Tables pièce-case figées par défaut (trop de paramètres pour la quantité de données : surapprentissage).
const frozen = new Uint8Array(v.length);
TUNE_SPEC.forEach((p, i) => (frozen[i] = !tunePst && p.path.startsWith('psqt.') ? 1 : 0));
const v0 = Float64Array.from(v);
console.log(`${v.length - frozen.reduce((a, b) => a + b, 0)} paramètres réglés (tables pièce-case ${tunePst ? 'incluses' : 'figées'}), λ = ${lambda}`);
let best = { err: ev0, v: Float64Array.from(v), epoch: 0 };
for (let ep = 1; ep <= epochs; ep++) {
  adamEpoch(train, v, K, state, lr, 4096, frozen, { lambda, v0 });
  // Réextraction périodique (termes non linéaires : seuils, plafonds).
  if (ep % 10 === 0) {
    writeVector(params, v, false);
    samples = build();
    val = samples.slice(0, nVal);
    train = samples.slice(nVal);
  }
  const et = meanError(train, v, K);
  const evl = meanError(val, v, K);
  if (evl < best.err) best = { err: evl, v: Float64Array.from(v), epoch: ep };
  console.log(`époque ${ep} : entraînement ${et.toFixed(6)} validation ${evl.toFixed(6)}`);
}
writeVector(params, best.v, true);
const tuned: EngineConfig = { ...cloneConfig(base), name: `${base.name} (Texel)`, eval: params };
writeFileSync(out, JSON.stringify(tuned, null, 2));
const d = diffConfigs(base.eval, tuned.eval);
console.log(`Meilleure époque ${best.epoch}, validation ${best.err.toFixed(6)} (initiale ${ev0.toFixed(6)}). ${d.length} valeurs modifiées sur ${TUNE_SPEC.length}.`);
for (const x of d.filter((x) => !x.path.startsWith('psqt'))) console.log(`  ${x.path}: ${x.a} → ${x.b}`);
console.log(`Écrit : ${out}`);
