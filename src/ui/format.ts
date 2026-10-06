import { parseFen } from '../core/fen';
import { formatSanLine, uciLineToSan, uciToMove, moveToSan } from '../core/notation';

/** Centipawns (point de vue blancs) → « +0.47 ». */
export function fmtCp(cp: number | null | undefined, digits = 2): string {
  if (cp === null || cp === undefined || Number.isNaN(cp)) return '—';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(digits);
}

/** Score point de vue blancs avec mat éventuel (mate exprimé du point de vue blancs). */
export function fmtScore(cpWhite: number | null, mateWhite: number | null): string {
  if (mateWhite !== null && mateWhite !== undefined) return mateWhite > 0 ? `#${mateWhite}` : mateWhite < 0 ? `-#${-mateWhite}` : '#0';
  return fmtCp(cpWhite);
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('fr-FR');
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)} %`;
}

export function fmtElo(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'n/d';
  return (x >= 0 ? '+' : '') + x.toFixed(0);
}

/** Ligne UCI → SAN numérotée depuis une FEN. */
export function pvToSan(fen: string, pv: string[], max = 12): string {
  try {
    const pos = parseFen(fen);
    const sans = uciLineToSan(pos, pv.slice(0, max));
    return formatSanLine(sans, pos.fullmove, pos.side === 0) + (pv.length > max ? ' …' : '');
  } catch {
    return pv.join(' ');
  }
}

export function uciToSanSafe(fen: string, uci: string | null): string {
  if (!uci) return '—';
  try {
    const pos = parseFen(fen);
    const m = uciToMove(pos, uci);
    return m === null ? uci : moveToSan(pos, m);
  } catch {
    return uci;
  }
}

export function whiteToMove(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}

/** Score point de vue blancs où les mats sont codés ±(10000 − n) (voir match/compare). */
export function fmtWhite(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  if (Math.abs(s) >= 9000) {
    const n = 10000 - Math.abs(s);
    return s > 0 ? `#${n}` : `-#${n}`;
  }
  return fmtCp(s);
}
