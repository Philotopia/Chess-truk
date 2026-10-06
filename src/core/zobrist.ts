// Clés de Zobrist 64 bits, représentées par deux entiers 32 bits (lo / hi)
// afin de rester en arithmétique entière rapide en JavaScript.
// Générateur déterministe : les hachages sont identiques d'une exécution à l'autre.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}

const rnd = mulberry32(0x5eed1234);

/** Index : pièce (0..15) * 128 + case 0x88. */
export const Z_PIECE_LO = new Int32Array(16 * 128);
export const Z_PIECE_HI = new Int32Array(16 * 128);
export const Z_CASTLE_LO = new Int32Array(16);
export const Z_CASTLE_HI = new Int32Array(16);
export const Z_EP_LO = new Int32Array(8);
export const Z_EP_HI = new Int32Array(8);
export let Z_SIDE_LO = 0;
export let Z_SIDE_HI = 0;

for (let i = 0; i < 16 * 128; i++) {
  Z_PIECE_LO[i] = rnd();
  Z_PIECE_HI[i] = rnd();
}
// Les droits de roque sont combinés par XOR de 4 clés élémentaires.
const castleBaseLo = [rnd(), rnd(), rnd(), rnd()];
const castleBaseHi = [rnd(), rnd(), rnd(), rnd()];
for (let r = 0; r < 16; r++) {
  let lo = 0;
  let hi = 0;
  for (let b = 0; b < 4; b++) {
    if (r & (1 << b)) {
      lo ^= castleBaseLo[b];
      hi ^= castleBaseHi[b];
    }
  }
  Z_CASTLE_LO[r] = lo;
  Z_CASTLE_HI[r] = hi;
}
for (let f = 0; f < 8; f++) {
  Z_EP_LO[f] = rnd();
  Z_EP_HI[f] = rnd();
}
Z_SIDE_LO = rnd();
Z_SIDE_HI = rnd();
