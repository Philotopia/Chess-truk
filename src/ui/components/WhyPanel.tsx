import { useMemo, useState } from 'react';
import { parseFen } from '../../core/fen';
import { PIECE_NAMES_FR, pieceType, sqName } from '../../core/types';
import { type EvalBreakdown, type EvalTraceEntry, MAX_PHASE, TRACE_KEY_LABELS, entryValue, evaluateDetailed } from '../../engine/evaluate';
import { EVAL_TERMS, EVAL_TERM_LABELS, EVAL_TERM_NOTES, type EvalParams, type EvalTerm } from '../../engine/params';
import { fmtCp } from '../format';

function describe(e: EvalTraceEntry, board: Int8Array): { who: string; what: string } {
  const key = TRACE_KEY_LABELS[e.key] ?? e.key;
  const n = e.n;
  if (e.key === 'pieces' && n !== undefined) {
    const t = Math.floor(n / 100);
    const c = n % 100;
    return { who: PIECE_NAMES_FR[t] + (c > 1 ? 's' : ''), what: `${c} × valeur` };
  }
  let who = 'Global';
  if (e.sq >= 0) {
    const p = board[e.sq];
    who = `${p ? PIECE_NAMES_FR[pieceType(p)] : 'Case'} ${sqName(e.sq)}`;
  }
  let what = key;
  if (e.key === 'mob' && n !== undefined) what = `${key} (${n} case${n > 1 ? 's' : ''} sûre${n > 1 ? 's' : ''})`;
  else if ((e.key === 'passed' || e.key === 'advance') && n !== undefined) what = `${key} (${n}e rangée)`;
  else if (e.key === 'kingPressure' && n !== undefined) what = `${key} (${Math.floor(n / 1000)} attaquants, ${n % 1000} unités)`;
  else if (e.key === 'kingProximity' && n !== undefined) what = `${key} (écart de distance ${n})`;
  else if (e.key === 'shield' && n !== undefined) what = `${key} (${n >> 4} au contact, ${n & 15} à deux cases)`;
  else if (['centerPawn', 'centerAttack', 'space', 'openFile', 'semiOpenFile', 'mopUpEdge', 'mopUpKings'].includes(e.key) && n !== undefined)
    what = `${key} (×${n})`;
  return { who, what };
}

const pawns = (cp: number) => fmtCp(cp, 2);

export function WhyPanel({ fen, params, title = 'Pourquoi ?' }: { fen: string; params: EvalParams; title?: string }) {
  const [open, setOpen] = useState<Set<EvalTerm>>(new Set());
  const [mode, setMode] = useState<'terms' | 'pieces'>('terms');
  const data = useMemo(() => {
    try {
      const pos = parseFen(fen);
      return { d: evaluateDetailed(pos, params), board: pos.board.slice(), error: null as string | null };
    } catch (e) {
      return { d: null as EvalBreakdown | null, board: new Int8Array(128), error: (e as Error).message };
    }
  }, [fen, params]);
  if (!data.d) return <div className="panel">FEN invalide : {data.error}</div>;
  const { d, board } = data;
  const mgPct = Math.round((d.phase / MAX_PHASE) * 100);

  const toggle = (t: EvalTerm) => {
    const s = new Set(open);
    if (s.has(t)) s.delete(t);
    else s.add(t);
    setOpen(s);
  };

  // Contributions par camp et par composante (chacune du point de vue de son camp).
  const perSide = (t: EvalTerm, color: 0 | 1) =>
    d.entries.filter((e) => e.term === t && e.color === color).reduce((s, e) => s + entryValue(e, d.phase), 0);

  // Vue par pièce : regroupement par case.
  const byPiece = new Map<string, { color: 0 | 1; items: { label: string; v: number }[]; total: number }>();
  for (const e of d.entries) {
    if (e.sq < 0 || e.term === 'material') continue;
    const { who, what } = describe(e, board);
    const k = `${e.color}:${who}`;
    const v = entryValue(e, d.phase);
    const g = byPiece.get(k) ?? { color: e.color, items: [], total: 0 };
    g.items.push({ label: `${what} [${EVAL_TERM_LABELS[e.term]}]`, v });
    g.total += v;
    byPiece.set(k, g);
  }

  return (
    <div className="panel why">
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="seg">
          <button className={mode === 'terms' ? 'on' : ''} onClick={() => setMode('terms')}>
            Composantes
          </button>
          <button className={mode === 'pieces' ? 'on' : ''} onClick={() => setMode('pieces')}>
            Par pièce
          </button>
        </div>
      </div>
      <div className="why-total">
        Évaluation statique : <b>{pawns(d.exact)}</b> <span className="muted">(point de vue blancs, {Math.round(d.exact)} cp)</span>
        <div className="muted small">
          Phase {d.phase}/{MAX_PHASE} → {mgPct} % milieu de partie, {100 - mgPct} % finale. Valeurs interpolées
          (MG×phase + EG×(24−phase))/24.
        </div>
      </div>
      {mode === 'terms' ? (
        <table className="why-table">
          <thead>
            <tr>
              <th>Composante</th>
              <th className="num">Blancs</th>
              <th className="num">Noirs</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {EVAL_TERMS.map((t) => {
              const net = d.terms[t].value;
              const w = perSide(t, 0);
              const b = perSide(t, 1);
              const disabled = params.enabled[t] === false;
              const isOpen = open.has(t);
              const entries = d.entries.filter((e) => e.term === t);
              return [
                <tr key={t} className={`why-row ${disabled ? 'disabled' : ''}`} onClick={() => toggle(t)}>
                  <td>
                    <span className="caret">{entries.length ? (isOpen ? '▾' : '▸') : ' '}</span>
                    {EVAL_TERM_LABELS[t]}
                    {disabled && <span className="tag">désactivée</span>}
                  </td>
                  <td className="num">{w ? pawns(w) : ''}</td>
                  <td className="num">{b ? pawns(b) : ''}</td>
                  <td className={`num strong ${net > 0.5 ? 'pos' : net < -0.5 ? 'neg' : ''}`}>{pawns(net)}</td>
                </tr>,
                isOpen && (
                  <tr key={t + '-d'} className="why-detail">
                    <td colSpan={4}>
                      {EVAL_TERM_NOTES[t] && <div className="note">{EVAL_TERM_NOTES[t]}</div>}
                      <div className="entries">
                        {[0, 1].map((c) => (
                          <div key={c}>
                            <div className="entries-head">{c === 0 ? 'Blancs' : 'Noirs'}</div>
                            {entries
                              .filter((e) => e.color === c)
                              .map((e, i) => {
                                const { who, what } = describe(e, board);
                                return (
                                  <div key={i} className="entry" title={`MG ${e.mg} / EG ${e.eg}`}>
                                    <span>
                                      {who} : {what}
                                    </span>
                                    <span className="num">{pawns(entryValue(e, d.phase))}</span>
                                  </div>
                                );
                              })}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            <tr className="why-total-row">
              <td>TOTAL</td>
              <td />
              <td />
              <td className="num strong">{pawns(d.exact)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="pieces-view">
          {[0, 1].map((c) => (
            <div key={c}>
              <div className="entries-head">{c === 0 ? 'Blancs' : 'Noirs'} (du point de vue du camp)</div>
              {[...byPiece.entries()]
                .filter(([, g]) => g.color === c)
                .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
                .map(([k, g]) => (
                  <details key={k} className="piece-group">
                    <summary>
                      <span>{k.split(':')[1]}</span>
                      <span className="num strong">{pawns(g.total)}</span>
                    </summary>
                    {g.items.map((it, i) => (
                      <div key={i} className="entry">
                        <span>{it.label}</span>
                        <span className="num">{pawns(it.v)}</span>
                      </div>
                    ))}
                  </details>
                ))}
            </div>
          ))}
          <div className="note">Le matériel et les termes globaux (centre, espace, paire de fous, trait) ne sont pas rattachés à une pièce.</div>
        </div>
      )}
    </div>
  );
}
