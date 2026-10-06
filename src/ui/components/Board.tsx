import { useMemo, useState } from 'react';
import { parseFen } from '../../core/fen';
import { moveToUci } from '../../core/notation';
import { PIECE_CHARS, makeSq, sqName } from '../../core/types';

// Glyphes pleins pour les deux camps (couleur par CSS) ; U+FE0E force le rendu texte (pas d'émoji).
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export interface Arrow {
  from: string;
  to: string;
  color: string;
}

interface Props {
  fen: string;
  orientation?: 'white' | 'black';
  lastMove?: { from: string; to: string } | null;
  interactive?: boolean;
  onMove?: (uci: string) => void;
  arrows?: Arrow[];
  showLegal?: boolean;
}

export function Board({ fen, orientation = 'white', lastMove, interactive = false, onMove, arrows = [], showLegal = true }: Props) {
  const parsed = useMemo(() => {
    try {
      const pos = parseFen(fen);
      const legal = pos.legalMoves().map(moveToUci);
      const check = pos.inCheck() ? sqName(pos.kingSq[pos.side]) : null;
      const board: Record<string, string> = {};
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          const p = pos.board[makeSq(f, r)];
          if (p) board[sqName(makeSq(f, r))] = PIECE_CHARS[p];
        }
      return { legal, check, board, side: pos.side };
    } catch {
      return { legal: [] as string[], check: null, board: {} as Record<string, string>, side: 0 };
    }
  }, [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  const targets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(parsed.legal.filter((u) => u.startsWith(selected)).map((u) => u.slice(2, 4)));
  }, [selected, parsed]);

  const ownPiece = (sq: string) => {
    const c = parsed.board[sq];
    if (!c) return false;
    return (c === c.toUpperCase()) === (parsed.side === 0);
  };

  const tryMove = (from: string, to: string) => {
    const cands = parsed.legal.filter((u) => u.startsWith(from + to));
    if (cands.length === 0) return false;
    if (cands.length > 1) {
      setPromo({ from, to });
      return true;
    }
    onMove?.(cands[0]);
    setSelected(null);
    return true;
  };

  const onSquareClick = (sq: string) => {
    if (!interactive) return;
    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    setSelected(ownPiece(sq) ? (selected === sq ? null : sq) : null);
  };

  const rows = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const rank = orientation === 'white' ? 7 - i : i;
      const file = orientation === 'white' ? j : 7 - j;
      const sq = 'abcdefgh'[file] + (rank + 1);
      const light = (rank + file) % 2 === 1;
      const pc = parsed.board[sq];
      const cls = ['sq', light ? 'light' : 'dark'];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push('last');
      if (selected === sq) cls.push('sel');
      if (parsed.check === sq) cls.push('check');
      rows.push(
        <div
          key={sq}
          className={cls.join(' ')}
          data-square={sq}
          onClick={() => onSquareClick(sq)}
          onDragOver={(e) => interactive && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = e.dataTransfer.getData('text/plain');
            if (from && from !== sq) tryMove(from, sq);
          }}
        >
          {pc && (
            <span
              className={`piece ${pc === pc.toUpperCase() ? 'w' : 'b'}`}
              draggable={interactive && ownPiece(sq)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', sq);
                setSelected(sq);
              }}
            >
              {GLYPH[pc.toLowerCase()]}
              {'︎'}
            </span>
          )}
          {showLegal && targets.has(sq) && <span className={pc ? 'hint capture' : 'hint'} />}
          {j === 0 && <span className="coord rank">{rank + 1}</span>}
          {i === 7 && <span className="coord file">{'abcdefgh'[file]}</span>}
        </div>,
      );
    }
  }

  const center = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    const x = orientation === 'white' ? f : 7 - f;
    const y = orientation === 'white' ? 7 - r : r;
    return [x + 0.5, y + 0.5];
  };

  return (
    <div className="board-wrap">
      <div className="board">{rows}</div>
      <svg className="arrows" viewBox="0 0 8 8" aria-hidden>
        <defs>
          {arrows.map((a, k) => (
            <marker key={k} id={`ah${k}`} markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
              <path d="M0,0 L4,2 L0,4 z" fill={a.color} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, k) => {
          const [x1, y1] = center(a.from);
          const [x2, y2] = center(a.to);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const shorten = 0.35;
          return (
            <line
              key={k}
              x1={x1}
              y1={y1}
              x2={x2 - (dx / len) * shorten}
              y2={y2 - (dy / len) * shorten}
              stroke={a.color}
              strokeWidth={0.15}
              strokeLinecap="round"
              opacity={0.8}
              markerEnd={`url(#ah${k})`}
            />
          );
        })}
      </svg>
      {promo && (
        <div className="promo">
          {['q', 'r', 'b', 'n'].map((p) => (
            <button
              key={p}
              className={`piece ${parsed.side === 0 ? 'w' : 'b'}`}
              onClick={() => {
                onMove?.(promo.from + promo.to + p);
                setPromo(null);
                setSelected(null);
              }}
            >
              {GLYPH[p]}
              {'︎'}
            </button>
          ))}
          <button className="btn small" onClick={() => setPromo(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
