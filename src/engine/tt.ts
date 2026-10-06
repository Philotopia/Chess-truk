// Table de transposition à adressage direct, stockée dans des tableaux typés (aucune allocation par entrée).
// Index = bits bas de la clé lo ; vérification par la clé hi (32 bits) → 64 bits de hachage au total.

export const TT_EXACT = 1;
export const TT_LOWER = 2; // score ≥ valeur stockée (coupure beta)
export const TT_UPPER = 3; // score ≤ valeur stockée (échec bas)

const BYTES_PER_ENTRY = 4 + 4 + 4 + 2 + 1 + 1 + 1;

export class TranspositionTable {
  readonly size: number;
  private mask: number;
  private keyLo: Int32Array;
  private keyHi: Int32Array;
  private moves: Int32Array;
  private scores: Int16Array;
  private depths: Int8Array;
  private flags: Uint8Array;
  private ages: Uint8Array;
  private age = 0;
  // Statistiques.
  probes = 0;
  hits = 0;
  stores = 0;

  /** Résultat de la dernière sonde réussie. */
  hitMove = 0;
  hitScore = 0;
  hitDepth = 0;
  hitFlag = 0;

  constructor(sizeMB: number) {
    const target = Math.max(1024, Math.floor((sizeMB * 1024 * 1024) / BYTES_PER_ENTRY));
    let n = 1;
    while (n * 2 <= target) n *= 2;
    this.size = n;
    this.mask = n - 1;
    this.keyLo = new Int32Array(n);
    this.keyHi = new Int32Array(n);
    this.moves = new Int32Array(n);
    this.scores = new Int16Array(n);
    this.depths = new Int8Array(n);
    this.flags = new Uint8Array(n);
    this.ages = new Uint8Array(n);
  }

  get sizeMB(): number {
    return (this.size * BYTES_PER_ENTRY) / (1024 * 1024);
  }

  clear(): void {
    this.flags.fill(0);
    this.moves.fill(0);
    this.age = 0;
    this.probes = this.hits = this.stores = 0;
  }

  /** À appeler au début de chaque recherche : les anciennes entrées deviennent remplaçables. */
  newSearch(): void {
    this.age = (this.age + 1) & 255;
  }

  /** Sonde la table ; en cas de succès, remplit hitMove/hitScore/hitDepth/hitFlag (score brut, non ajusté au ply). */
  probe(lo: number, hi: number): boolean {
    this.probes++;
    const i = lo & this.mask;
    if (this.flags[i] !== 0 && this.keyHi[i] === hi && this.keyLo[i] === lo) {
      this.hits++;
      this.hitMove = this.moves[i];
      this.hitScore = this.scores[i];
      this.hitDepth = this.depths[i];
      this.hitFlag = this.flags[i];
      this.ages[i] = this.age;
      return true;
    }
    return false;
  }

  /** Stratégie de remplacement : même position, entrée d'une recherche précédente, ou profondeur ≥. */
  store(lo: number, hi: number, depth: number, flag: number, score: number, move: number): void {
    const i = lo & this.mask;
    const same = this.keyHi[i] === hi && this.keyLo[i] === lo;
    // Même position, même recherche : on ne remplace pas une entrée nettement plus profonde (ex. entrée de quiescence).
    if (same && this.ages[i] === this.age && depth + 2 < this.depths[i] && this.flags[i] !== 0) return;
    if (this.flags[i] === 0 || same || this.ages[i] !== this.age || depth >= this.depths[i]) {
      // Conserver le coup existant si on n'en fournit pas pour la même position.
      if (move !== 0 || !same) this.moves[i] = move;
      this.keyLo[i] = lo;
      this.keyHi[i] = hi;
      this.scores[i] = score;
      this.depths[i] = depth > 127 ? 127 : depth;
      this.flags[i] = flag;
      this.ages[i] = this.age;
      this.stores++;
    }
  }

  /** Coup mémorisé pour une position (0 si absent). */
  bestMove(lo: number, hi: number): number {
    const i = lo & this.mask;
    if (this.flags[i] !== 0 && this.keyHi[i] === hi && this.keyLo[i] === lo) return this.moves[i];
    return 0;
  }

  /** Occupation en ‰ (entrées de la recherche courante, sur un échantillon de 1000 entrées). */
  hashfull(): number {
    const n = Math.min(1000, this.size);
    let used = 0;
    for (let i = 0; i < n; i++) if (this.flags[i] !== 0 && this.ages[i] === this.age) used++;
    return Math.round((used * 1000) / n);
  }

  /** Occupation totale en ‰ (toutes générations confondues). */
  fill(): number {
    const n = Math.min(4096, this.size);
    let used = 0;
    for (let i = 0; i < n; i++) if (this.flags[i] !== 0) used++;
    return Math.round((used * 1000) / n);
  }
}
