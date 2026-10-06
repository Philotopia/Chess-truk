// Jeux de positions de test : import FEN / EPD / PGN, et résultats d'analyse par position.
import { parseFen, toFen } from '../core/fen';
import { sanToMove } from '../core/notation';
import { parseMultiPgn } from '../core/pgn';
import { moveToUci } from '../core/notation';

export interface DatasetPosition {
  fen: string;
  id?: string;
  source?: string;
  /** Meilleurs coups attendus (EPD « bm »), en UCI. */
  bestMoves?: string[];
  /** Coups à éviter (EPD « am »), en UCI. */
  avoidMoves?: string[];
}

export interface Dataset {
  id: string;
  name: string;
  createdAt: string;
  positions: DatasetPosition[];
}

export interface DatasetResult {
  fen: string;
  id?: string;
  staticEval: number;
  trukScore: number;
  trukMate: number | null;
  trukMove: string | null;
  trukDepth: number;
  trukNodes: number;
  trukTimeMs: number;
  sfScore: number | null;
  sfMate: number | null;
  sfMove: string | null;
  sfDepth: number;
  sfNodes: number;
  sfTimeMs: number;
  /** Truk − SF (point de vue blancs). */
  delta: number | null;
  sameMove: boolean | null;
  /** Résolu (si bm/am fournis). */
  solved: boolean | null;
}

export interface ImportReport {
  positions: DatasetPosition[];
  errors: string[];
}

function epdOps(ops: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of ops.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const sp = p.indexOf(' ');
    if (sp < 0) out[p] = '';
    else out[p.slice(0, sp)] = p.slice(sp + 1).replace(/^"|"$/g, '');
  }
  return out;
}

/** Une ligne : FEN complète (6 champs) ou EPD (4 champs + opérations). */
export function parsePositionLine(line: string): DatasetPosition {
  const t = line.trim().split(/\s+/);
  if (t.length < 4) throw new Error('ligne trop courte');
  const isFull = t.length >= 6 && /^\d+$/.test(t[4]) && /^\d+$/.test(t[5]);
  if (isFull) {
    const fen = t.slice(0, 6).join(' ');
    return { fen: toFen(parseFen(fen)) };
  }
  const fen4 = t.slice(0, 4).join(' ');
  const ops = epdOps(t.slice(4).join(' '));
  const hm = ops.hmvc ?? '0';
  const fm = ops.fmvn ?? '1';
  const pos = parseFen(`${fen4} ${hm} ${fm}`);
  const res: DatasetPosition = { fen: toFen(pos) };
  if (ops.id) res.id = ops.id;
  const conv = (s: string) =>
    s
      .split(/\s+/)
      .filter(Boolean)
      .map((san) => {
        const m = sanToMove(pos, san);
        if (m === null) throw new Error(`coup EPD invalide « ${san} »`);
        return moveToUci(m);
      });
  if (ops.bm) res.bestMoves = conv(ops.bm);
  if (ops.am) res.avoidMoves = conv(ops.am);
  return res;
}

/** Détecte le format (PGN ou liste FEN/EPD) et importe les positions. */
export function importPositions(text: string, opts: { pgnEvery?: number; pgnSkip?: number } = {}): ImportReport {
  const errors: string[] = [];
  const positions: DatasetPosition[] = [];
  if (/^\s*\[\w+\s+"/m.test(text) || /^\s*1\.\s*\S/m.test(text)) {
    const every = Math.max(1, opts.pgnEvery ?? 6);
    const skip = opts.pgnSkip ?? 8;
    const { games, errors: e } = parseMultiPgn(text);
    errors.push(...e);
    games.forEach((g, gi) => {
      for (let i = skip; i < g.game.moves.length; i += every) {
        positions.push({ fen: g.game.fenAt(i), source: `partie ${gi + 1}, demi-coup ${i}` });
      }
    });
    return { positions, errors };
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) return;
    try {
      positions.push({ ...parsePositionLine(l), source: `ligne ${i + 1}` });
    } catch (e) {
      errors.push(`Ligne ${i + 1} : ${(e as Error).message}`);
    }
  });
  return { positions, errors };
}

export function datasetResultsToCsv(rows: DatasetResult[]): string {
  const head = [
    'fen', 'id', 'static_eval', 'truk_score', 'truk_mate', 'truk_move', 'truk_depth', 'truk_nodes', 'truk_ms',
    'sf_score', 'sf_mate', 'sf_move', 'sf_depth', 'sf_nodes', 'sf_ms', 'delta', 'same_move', 'solved',
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.fen, r.id, r.staticEval, r.trukScore, r.trukMate, r.trukMove, r.trukDepth, r.trukNodes, r.trukTimeMs.toFixed(0),
      r.sfScore, r.sfMate, r.sfMove, r.sfDepth, r.sfNodes, r.sfTimeMs.toFixed(0), r.delta, r.sameMove, r.solved,
    ].map(esc).join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
