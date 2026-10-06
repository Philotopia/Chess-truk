import { fmtScore } from '../format';

/** Barre d'évaluation verticale (score point de vue blancs). */
export function EvalBar({ cp, mate, flipped = false }: { cp: number | null; mate: number | null; flipped?: boolean }) {
  let p = 0.5;
  if (mate !== null) p = mate > 0 ? 1 : mate < 0 ? 0 : 0.5;
  else if (cp !== null) p = 1 / (1 + Math.pow(10, -cp / 400));
  const whitePct = Math.round(p * 1000) / 10;
  return (
    <div className={`evalbar ${flipped ? 'flipped' : ''}`} title={`Évaluation : ${fmtScore(cp, mate)}`}>
      <div className="evalbar-white" style={{ height: `${whitePct}%` }} />
      <span className="evalbar-label">{fmtScore(cp, mate)}</span>
    </div>
  );
}
