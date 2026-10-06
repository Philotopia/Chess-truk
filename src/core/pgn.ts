import { Game, type GameResult } from './game';
import { START_FEN } from './types';

export interface PgnGame {
  headers: Record<string, string>;
  game: Game;
  result: GameResult;
  /** Commentaires par demi-coup (index du coup → texte), optionnels. */
  comments?: Record<number, string>;
}

const HEADER_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

/** Exporte une partie au format PGN. Les commentaires {…} sont insérés après les coups. */
export function exportPgn(
  game: Game,
  headers: Record<string, string>,
  result: GameResult,
  comments?: Record<number, string>,
): string {
  const h: Record<string, string> = {
    Event: '?',
    Site: 'Chess-truk Lab',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: '?',
    White: '?',
    Black: '?',
    ...headers,
    Result: result,
  };
  if (game.startFen !== START_FEN) {
    h.SetUp = '1';
    h.FEN = game.startFen;
  }
  const keys = [...HEADER_ORDER, ...Object.keys(h).filter((k) => !HEADER_ORDER.includes(k))];
  let out = '';
  for (const k of keys) {
    if (h[k] === undefined) continue;
    out += `[${k} "${String(h[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]\n`;
  }
  out += '\n';
  const startParts = game.startFen.split(' ');
  let fm = parseInt(startParts[5] || '1', 10);
  let white = startParts[1] === 'w';
  const tokens: string[] = [];
  game.moves.forEach((m, i) => {
    if (white) tokens.push(`${fm}.`);
    else if (i === 0) tokens.push(`${fm}...`);
    tokens.push(m.san);
    if (comments && comments[i]) tokens.push(`{${comments[i].replace(/[{}]/g, '')}}`);
    if (!white) fm++;
    white = !white;
  });
  tokens.push(result);
  // Retour à la ligne vers 80 caractères.
  let line = '';
  for (const t of tokens) {
    if (line.length + t.length + 1 > 80) {
      out += line.trimEnd() + '\n';
      line = '';
    }
    line += t + ' ';
  }
  out += line.trimEnd() + '\n';
  return out;
}

/** Découpe un fichier PGN contenant plusieurs parties. */
export function splitPgn(text: string): string[] {
  const games: string[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let cur: string[] = [];
  let inMoves = false;
  for (const line of lines) {
    const isHeader = /^\s*\[/.test(line);
    if (isHeader && inMoves) {
      games.push(cur.join('\n'));
      cur = [];
      inMoves = false;
    }
    if (!isHeader && line.trim() !== '') inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim() !== '') games.push(cur.join('\n'));
  return games;
}

/** Analyse une partie PGN (variantes, NAG et commentaires sont ignorés). */
export function parsePgn(text: string): PgnGame {
  const headers: Record<string, string> = {};
  const headerRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm;
  let mt: RegExpExecArray | null;
  while ((mt = headerRe.exec(text))) headers[mt[1]] = mt[2].replace(/\\(.)/g, '$1');
  let body = text.replace(/^\s*\[.*\]\s*$/gm, '');
  body = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // Suppression des variantes (imbriquées).
  let prev = '';
  while (prev !== body) {
    prev = body;
    body = body.replace(/\([^()]*\)/g, ' ');
  }
  body = body.replace(/\$\d+/g, ' ');
  const startFen = headers.FEN || START_FEN;
  const game = new Game(startFen);
  let result: GameResult = (headers.Result as GameResult) || '*';
  const tokens = body.split(/\s+/).filter(Boolean);
  for (let tok of tokens) {
    if (tok === '1-0' || tok === '0-1' || tok === '1/2-1/2' || tok === '*') {
      result = tok;
      continue;
    }
    tok = tok.replace(/^\d+\.(\.\.)?/, '');
    if (tok === '' || /^\d+\.*$/.test(tok)) continue;
    game.playSan(tok);
  }
  return { headers, game, result };
}

/** Analyse plusieurs parties ; les parties invalides sont signalées dans errors. */
export function parseMultiPgn(text: string): { games: PgnGame[]; errors: string[] } {
  const games: PgnGame[] = [];
  const errors: string[] = [];
  splitPgn(text).forEach((g, i) => {
    try {
      games.push(parsePgn(g));
    } catch (e) {
      errors.push(`Partie ${i + 1} : ${(e as Error).message}`);
    }
  });
  return { games, errors };
}
