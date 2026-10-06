import { useEffect, useRef } from 'react';

export interface MoveItem {
  san: string;
  note?: string;
  cls?: string;
}

/** Historique des coups, cliquable (navigation dans la partie). */
export function MoveList({
  moves,
  startFullmove = 1,
  whiteFirst = true,
  current,
  onSelect,
}: {
  moves: MoveItem[];
  startFullmove?: number;
  whiteFirst?: boolean;
  current: number;
  onSelect: (ply: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.mv.cur');
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [current, moves.length]);
  const rows: { num: number; w?: number; b?: number }[] = [];
  let num = startFullmove;
  let i = 0;
  if (!whiteFirst && moves.length) {
    rows.push({ num, b: 0 });
    num++;
    i = 1;
  }
  for (; i < moves.length; i += 2) {
    rows.push({ num, w: i, b: i + 1 < moves.length ? i + 1 : undefined });
    num++;
  }
  const cell = (k?: number) =>
    k === undefined ? (
      <span className="mv empty" />
    ) : (
      <span className={`mv ${current === k + 1 ? 'cur' : ''} ${moves[k].cls ?? ''}`} onClick={() => onSelect(k + 1)} title={moves[k].note}>
        {moves[k].san}
      </span>
    );
  return (
    <div className="movelist" ref={ref}>
      {rows.length === 0 && <div className="muted">Aucun coup.</div>}
      {rows.map((r) => (
        <div key={r.num} className="mvrow">
          <span className="num">{r.num}.</span>
          {r.w === undefined ? <span className="mv empty">…</span> : cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}

export function NavButtons({ ply, max, onChange }: { ply: number; max: number; onChange: (p: number) => void }) {
  return (
    <div className="nav-buttons">
      <button className="btn small" onClick={() => onChange(0)} disabled={ply === 0} title="Début">
        ⏮
      </button>
      <button className="btn small" onClick={() => onChange(Math.max(0, ply - 1))} disabled={ply === 0} title="Précédent">
        ◀
      </button>
      <button className="btn small" onClick={() => onChange(Math.min(max, ply + 1))} disabled={ply >= max} title="Suivant">
        ▶
      </button>
      <button className="btn small" onClick={() => onChange(max)} disabled={ply >= max} title="Fin">
        ⏭
      </button>
    </div>
  );
}
