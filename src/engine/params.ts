// Paramètres du moteur : structure unique, sérialisable en JSON, éditable depuis l'interface,
// et prête pour une optimisation automatique ultérieure (voir TUNABLE_PARAMS).

export interface Score2 {
  mg: number;
  eg: number;
}

export interface Table2 {
  /** 64 valeurs en ordre visuel du point de vue des blancs : index 0 = a8, 7 = h8, 56 = a1, 63 = h1. */
  mg: number[];
  eg: number[];
}

export const EVAL_TERMS = [
  'material',
  'psqt',
  'mobility',
  'pawnStructure',
  'pawnAdvancement',
  'passedPawns',
  'center',
  'space',
  'kingSafety',
  'kingEndgame',
  'bishopPair',
  'rooks',
  'outposts',
  'development',
  'threats',
  'tempo',
  'mopUp',
] as const;
export type EvalTerm = (typeof EVAL_TERMS)[number];

export const EVAL_TERM_LABELS: Record<EvalTerm, string> = {
  material: 'Matériel',
  psqt: 'Activité / placement (PST)',
  mobility: 'Mobilité',
  pawnStructure: 'Structure de pions',
  pawnAdvancement: 'Position des pions (rangée + colonne)',
  passedPawns: 'Pions passés',
  center: 'Contrôle du centre',
  space: 'Espace',
  kingSafety: 'Sécurité du roi',
  kingEndgame: 'Activité du roi (finale)',
  bishopPair: 'Paire de fous',
  rooks: 'Tours (colonnes, 7e rangée)',
  outposts: 'Avant-postes',
  development: 'Développement',
  threats: 'Menaces',
  tempo: 'Trait (tempo)',
  mopUp: 'Finale gagnante (roi adverse au bord)',
};

/** Recouvrements connus entre composantes : affichés dans l'interface pour éviter les doubles comptes invisibles. */
export const EVAL_TERM_NOTES: Partial<Record<EvalTerm, string>> = {
  psqt:
    'La table des pions vaut 0 par défaut : l’avancement et le centre sont comptés dans leurs propres composantes. ' +
    'La table des tours ne contient pas de bonus de 7e rangée (compté dans « Tours »). ' +
    'Corrélé avec la mobilité (une pièce centrale a souvent plus de cases).',
  mobility: 'Cases accessibles non occupées par ses propres pièces et non attaquées par un pion adverse, par rapport à une base par pièce.',
  pawnAdvancement:
    'Bonus par rangée (avancement) et par colonne pour tout pion, passé ou non. Le bonus « pion passé » et le contrôle du centre s’ajoutent séparément.',
  passedPawns: 'Un pion passé reçoit aussi le bonus d’avancement : les deux sont affichés séparément.',
  center: 'Pions sur d4/e4/d5/e5 et attaques sur ces cases. Les attaques de pièces recoupent partiellement la mobilité.',
  development: 'Corrélé avec la PST (un cavalier en b1 y est déjà pénalisé).',
  kingEndgame: 'Proximité des rois aux pions passés (finale). La centralisation du roi est dans la PST « roi finale ».',
  threats: 'Évaluation statique : ne tient pas compte du trait (la quiescence résout les captures).',
  mopUp:
    'Uniquement si le camp le plus faible n’a plus de pions et que l’écart matériel dépasse le seuil : bonus pour repousser son roi ' +
    'vers le bord et en rapprocher le roi fort (finale seulement). Recoupe un peu la PST « roi finale ».',
};

export const PIECE_KEYS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;
export type PieceKey = (typeof PIECE_KEYS)[number];

export interface EvalParams {
  pieceValues: { pawn: number; knight: number; bishop: number; rook: number; queen: number };
  psqt: Record<PieceKey, Table2>;
  /** Bonus d'avancement par rangée relative (index 0 = 1re rangée, 7 = 8e). */
  pawnAdvancement: number[];
  /** Bonus de colonne pour tout pion (index 0 = colonne a … 7 = colonne h). */
  pawnFile: number[];
  /** Bonus pion passé par rangée relative. */
  passedPawn: { mg: number[]; eg: number[] };
  protectedPassed: Score2;
  connectedPawn: Score2;
  isolatedPawn: Score2;
  doubledPawn: Score2;
  backwardPawn: Score2;
  /** Finale : bonus par unité de distance (roi adverse plus loin / roi ami plus près de la case devant le pion passé). */
  kingPasserProximity: number;
  mobility: {
    knight: Score2;
    bishop: Score2;
    rook: Score2;
    queen: Score2;
    /** Nombre de cases « normal » soustrait avant pondération. */
    baseline: { knight: number; bishop: number; rook: number; queen: number };
  };
  center: { pawnOccupation: number; attack: number };
  space: number;
  kingSafety: {
    shieldRank1: number;
    shieldRank2: number;
    semiOpenFile: number;
    openFile: number;
    attackWeights: { knight: number; bishop: number; rook: number; queen: number };
    /** Malus = min(cap, unités² × scale / 100), si au moins minAttackers attaquants. */
    attackScale: number;
    attackCap: number;
    minAttackers: number;
  };
  bishopPair: Score2;
  rookOpenFile: Score2;
  rookSemiOpenFile: Score2;
  rookOnSeventh: Score2;
  outpost: { knight: Score2; bishop: Score2 };
  development: { undevelopedMinor: number };
  threats: { attackedByPawn: Score2; hanging: Score2 };
  tempo: Score2;
  /** Finale gagnante : par case de distance du roi faible au centre, et par case de rapprochement des rois. */
  mopUp: { edge: number; proximity: number; minAdvantage: number };
  /** Activation de chaque composante (false = composante ignorée). */
  enabled: Record<EvalTerm, boolean>;
}

export interface SearchOptions {
  useTT: boolean;
  ttSizeMB: number;
  quiescence: boolean;
  /** Tri des captures par MVV-LVA (sinon ordre de génération). */
  mvvLva: boolean;
  killers: boolean;
  history: boolean;
  pvs: boolean;
  aspiration: boolean;
  aspirationWindow: number;
  nullMove: boolean;
  lmr: boolean;
  checkExtension: boolean;
  // --- V2 : chaque technique reste activable séparément pour mesurer son effet ---
  /** Réductions LMR logarithmiques (profondeur × rang du coup), ajustées par l'historique. Sinon : 1 ou 2 plies. */
  lmrLog: boolean;
  /** Null move à réduction adaptative R = 3 + prof/4 (+ marge d'éval). Sinon : R = 2 ou 3. */
  nullMoveAdaptive: boolean;
  /** Reverse futility pruning : éval statique largement ≥ bêta à faible profondeur → coupure. */
  rfp: boolean;
  /** Futility pruning : coups calmes ignorés si l'éval + marge reste ≤ alpha. */
  futility: boolean;
  /** Late move pruning : au-delà d'un nombre de coups calmes, les suivants sont ignorés à faible profondeur. */
  lmp: boolean;
  /** Razoring : éval très basse à faible profondeur → vérification par quiescence. */
  razoring: boolean;
  /** SEE : captures perdantes triées en dernier, élaguées en quiescence et à faible profondeur. */
  see: boolean;
  /** Table de transposition aussi en quiescence. */
  qsTT: boolean;
  /** Internal iterative reduction : sans coup en table, profondeur − 1. */
  iir: boolean;
  /** Heuristique du contre-coup (réponse ayant réfuté le coup adverse précédent). */
  countermove: boolean;
  /** Extension singulière : le coup de table est prolongé s'il est nettement meilleur que tous les autres. */
  singular: boolean;
}

export interface EngineConfig {
  /** Version du format de configuration (pour migrations futures). */
  formatVersion: 1;
  name: string;
  eval: EvalParams;
  search: SearchOptions;
}

// --- Valeurs par défaut ---------------------------------------------------

const Z = (): number[] => new Array(64).fill(0);
const S = (mg: number, eg: number): Score2 => ({ mg, eg });

// Tables inspirées de la « Simplified Evaluation Function » (T. Michniewski), ordre a8 → h1.
const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
// Sans bonus de 7e rangée (compté dans « Tours »).
const ROOK_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  -5, 0, 5, 5, 5, 5, 0, -5,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_MG_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const KING_EG_PST = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

/**
 * Valeurs V2 : coefficients scalaires réglés par la méthode Texel en deux tours (self-play Truk uniquement,
 * 250 000 puis 590 000 positions calmes, contraintes de signe, avancement des pions et PST pions figés),
 * validés par SPRT : +42 Elo [+20 ; +65] puis +38 Elo [+17 ; +58]. Les tables pièce-case restent celles de la V1.
 */
export const TEXEL_V2_OVERRIDES: [string, number][] = [
  ['pieceValues.knight', 317],
  ['pieceValues.bishop', 343],
  ['pieceValues.rook', 521],
  ['pieceValues.queen', 946],
  ['passedPawn.mg.1', 0],
  ['passedPawn.mg.2', 0],
  ['passedPawn.mg.3', 0],
  ['passedPawn.mg.5', 31],
  ['passedPawn.mg.6', 39],
  ['passedPawn.eg.1', 26],
  ['passedPawn.eg.2', 26],
  ['passedPawn.eg.3', 41],
  ['passedPawn.eg.4', 67],
  ['passedPawn.eg.5', 88],
  ['passedPawn.eg.6', 88],
  ['protectedPassed.mg', 0],
  ['protectedPassed.eg', 10],
  ['connectedPawn.mg', 7],
  ['connectedPawn.eg', 5],
  ['isolatedPawn.mg', -2],
  ['isolatedPawn.eg', -2],
  ['doubledPawn.mg', -26],
  ['doubledPawn.eg', -26],
  ['backwardPawn.mg', -11],
  ['backwardPawn.eg', -9],
  ['kingPasserProximity', 32],
  ['mobility.knight.mg', 5],
  ['mobility.knight.eg', 0],
  ['mobility.bishop.mg', 5],
  ['mobility.bishop.eg', 1],
  ['mobility.rook.mg', 3],
  ['mobility.rook.eg', 5],
  ['mobility.queen.mg', 2],
  ['mobility.queen.eg', 3],
  ['center.pawnOccupation', 0],
  ['center.attack', 0],
  ['space', 0],
  ['kingSafety.shieldRank1', 16],
  ['kingSafety.shieldRank2', 2],
  ['kingSafety.semiOpenFile', 0],
  ['kingSafety.openFile', -39],
  ['kingSafety.attackScale', 38],
  ['bishopPair.mg', 37],
  ['bishopPair.eg', 55],
  ['rookOpenFile.mg', 50],
  ['rookOpenFile.eg', 15],
  ['rookSemiOpenFile.mg', 33],
  ['rookSemiOpenFile.eg', 16],
  ['rookOnSeventh.mg', 22],
  ['rookOnSeventh.eg', 34],
  ['outpost.knight.mg', 30],
  ['outpost.knight.eg', 3],
  ['outpost.bishop.mg', 16],
  ['outpost.bishop.eg', 25],
  ['development.undevelopedMinor', 0],
  ['threats.attackedByPawn.mg', -44],
  ['threats.attackedByPawn.eg', -18],
  ['threats.hanging.mg', -22],
  ['threats.hanging.eg', -15],
  ['tempo.mg', 11],
  ['tempo.eg', 0],
];

export function defaultEvalParams(): EvalParams {
  const p = v1EvalParams();
  for (const [path, v] of TEXEL_V2_OVERRIDES) setByPath(p, path, v);
  return p;
}

/** Valeurs de la V1 (réglées à la main). */
export function v1EvalParams(): EvalParams {
  const enabled = {} as Record<EvalTerm, boolean>;
  for (const t of EVAL_TERMS) enabled[t] = true;
  return {
    pieceValues: { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900 },
    psqt: {
      pawn: { mg: Z(), eg: Z() },
      knight: { mg: [...KNIGHT_PST], eg: [...KNIGHT_PST] },
      bishop: { mg: [...BISHOP_PST], eg: [...BISHOP_PST] },
      rook: { mg: [...ROOK_PST], eg: [...ROOK_PST] },
      queen: { mg: [...QUEEN_PST], eg: [...QUEEN_PST] },
      king: { mg: [...KING_MG_PST], eg: [...KING_EG_PST] },
    },
    pawnAdvancement: [0, 0, 5, 12, 25, 50, 100, 0],
    pawnFile: [0, 0, 0, 0, 0, 0, 0, 0],
    passedPawn: { mg: [0, 5, 5, 10, 15, 20, 30, 0], eg: [0, 10, 10, 15, 25, 40, 60, 0] },
    protectedPassed: S(10, 15),
    connectedPawn: S(8, 6),
    isolatedPawn: S(-12, -10),
    doubledPawn: S(-10, -20),
    backwardPawn: S(-8, -6),
    kingPasserProximity: 5,
    mobility: {
      knight: S(4, 4),
      bishop: S(4, 5),
      rook: S(2, 4),
      queen: S(1, 2),
      baseline: { knight: 4, bishop: 6, rook: 6, queen: 12 },
    },
    center: { pawnOccupation: 10, attack: 3 },
    space: 2,
    kingSafety: {
      shieldRank1: 10,
      shieldRank2: 5,
      semiOpenFile: -10,
      openFile: -20,
      attackWeights: { knight: 2, bishop: 2, rook: 3, queen: 5 },
      attackScale: 40,
      attackCap: 500,
      minAttackers: 2,
    },
    bishopPair: S(30, 50),
    rookOpenFile: S(25, 10),
    rookSemiOpenFile: S(12, 6),
    rookOnSeventh: S(15, 25),
    outpost: { knight: S(20, 10), bishop: S(10, 5) },
    development: { undevelopedMinor: -10 },
    threats: { attackedByPawn: S(-20, -15), hanging: S(-10, -10) },
    tempo: S(10, 5),
    mopUp: { edge: 10, proximity: 4, minAdvantage: 300 },
    enabled,
  };
}

export function defaultSearchOptions(): SearchOptions {
  return {
    useTT: true,
    ttSizeMB: 16,
    quiescence: true,
    mvvLva: true,
    killers: true,
    history: true,
    pvs: true,
    aspiration: true,
    aspirationWindow: 35,
    nullMove: true,
    lmr: true,
    checkExtension: true,
    lmrLog: true,
    nullMoveAdaptive: true,
    rfp: true,
    futility: true,
    lmp: true,
    razoring: true,
    see: true,
    qsTT: true,
    iir: true,
    countermove: true,
    // Neutre en SPRT à 50 ms/coup (550 parties) : désactivée par défaut, disponible comme option.
    singular: false,
  };
}

/** Options de recherche de la V1 (pour comparer les versions à l'identique). */
export function v1SearchOptions(): SearchOptions {
  return {
    ...defaultSearchOptions(),
    lmrLog: false,
    nullMoveAdaptive: false,
    rfp: false,
    futility: false,
    lmp: false,
    razoring: false,
    see: false,
    qsTT: false,
    iir: false,
    countermove: false,
    singular: false,
  };
}

export function defaultEngineConfig(name = 'Truk V2'): EngineConfig {
  return { formatVersion: 1, name, eval: defaultEvalParams(), search: defaultSearchOptions() };
}

/** Configuration minimale imposée par le cahier des charges V1 (sans optimisations avancées). */
export function baselineSearchOptions(): SearchOptions {
  return {
    ...v1SearchOptions(),
    killers: false,
    history: false,
    pvs: false,
    aspiration: false,
    nullMove: false,
    lmr: false,
    checkExtension: false,
  };
}

export function cloneConfig<T>(c: T): T {
  return JSON.parse(JSON.stringify(c)) as T;
}

/** Fusionne une configuration importée avec les valeurs par défaut (champs manquants complétés). */
export function normalizeConfig(raw: unknown): EngineConfig {
  const def = defaultEngineConfig();
  const merge = (d: unknown, r: unknown): unknown => {
    if (Array.isArray(d)) {
      if (!Array.isArray(r) || r.length !== d.length) return d;
      return d.map((v, i) => (typeof r[i] === 'number' && Number.isFinite(r[i]) ? r[i] : v));
    }
    if (d && typeof d === 'object') {
      const out: Record<string, unknown> = {};
      const ro = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
      for (const k of Object.keys(d as object)) out[k] = merge((d as Record<string, unknown>)[k], ro[k]);
      return out;
    }
    if (typeof d === 'number') return typeof r === 'number' && Number.isFinite(r) ? r : d;
    if (typeof d === 'boolean') return typeof r === 'boolean' ? r : d;
    if (typeof d === 'string') return typeof r === 'string' ? r : d;
    return d;
  };
  return merge(def, raw) as EngineConfig;
}

// --- Accès par chemin (pour diff, éditeurs génériques et optimiseur futur) ---

export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

/** Liste des différences scalaires entre deux configurations (chemin, A, B). */
export function diffConfigs(a: unknown, b: unknown, prefix = ''): { path: string; a: unknown; b: unknown }[] {
  const out: { path: string; a: unknown; b: unknown }[] = [];
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      out.push(
        ...diffConfigs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k),
      );
    }
  } else if (a !== b) {
    out.push({ path: prefix, a, b });
  }
  return out;
}

export interface TunableParam {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Paramètres candidats à l'optimisation automatique (self-play ou ensemble de positions). */
export const TUNABLE_PARAMS: TunableParam[] = [
  { path: 'eval.pieceValues.knight', label: 'Valeur cavalier', min: 250, max: 400, step: 5 },
  { path: 'eval.pieceValues.bishop', label: 'Valeur fou', min: 250, max: 400, step: 5 },
  { path: 'eval.pieceValues.rook', label: 'Valeur tour', min: 400, max: 650, step: 10 },
  { path: 'eval.pieceValues.queen', label: 'Valeur dame', min: 750, max: 1100, step: 10 },
  { path: 'eval.mobility.knight.mg', label: 'Mobilité cavalier (MG)', min: 0, max: 12, step: 1 },
  { path: 'eval.mobility.bishop.mg', label: 'Mobilité fou (MG)', min: 0, max: 12, step: 1 },
  { path: 'eval.mobility.rook.eg', label: 'Mobilité tour (EG)', min: 0, max: 10, step: 1 },
  { path: 'eval.passedPawn.eg.5', label: 'Pion passé 6e (EG)', min: 0, max: 150, step: 5 },
  { path: 'eval.pawnAdvancement.5', label: 'Avancement 6e', min: 0, max: 120, step: 5 },
  { path: 'eval.center.attack', label: 'Attaque du centre', min: 0, max: 10, step: 1 },
  { path: 'eval.kingSafety.attackScale', label: 'Échelle attaque roi', min: 0, max: 100, step: 5 },
  { path: 'eval.bishopPair.eg', label: 'Paire de fous (EG)', min: 0, max: 100, step: 5 },
];
