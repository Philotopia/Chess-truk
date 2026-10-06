import { fmtInt, fmtMs, fmtScore, pvToSan, uciToSanSafe } from '../format';

export interface SearchSummary {
  depth: number;
  seldepth?: number;
  nodes: number;
  nps: number;
  timeMs: number;
  /** Point de vue blancs. */
  cpWhite: number | null;
  mateWhite: number | null;
  bestMove: string | null;
  pv: string[];
  hashfull?: number;
  ttSizeMB?: number;
  stopped?: boolean;
}

export function SearchInfoView({ title, fen, s, running }: { title: string; fen: string; s: SearchSummary | null; running?: boolean }) {
  return (
    <div className="panel search-info">
      <div className="panel-head">
        <h3>{title}</h3>
        {running && <span className="spinner" title="Recherche en cours" />}
      </div>
      {s ? (
        <>
          <div className="big-score">{fmtScore(s.cpWhite, s.mateWhite)}</div>
          <dl className="kv">
            <dt>Meilleur coup</dt>
            <dd className="strong">{uciToSanSafe(fen, s.bestMove)}</dd>
            <dt>Profondeur</dt>
            <dd>
              {s.depth}
              {s.seldepth ? ` / ${s.seldepth} sél.` : ''}
            </dd>
            <dt>Nœuds</dt>
            <dd>{fmtInt(s.nodes)}</dd>
            <dt>NPS</dt>
            <dd>{fmtInt(s.nps)}</dd>
            <dt>Temps</dt>
            <dd>{fmtMs(s.timeMs)}</dd>
            {s.hashfull !== undefined && (
              <>
                <dt>TT</dt>
                <dd>
                  {(s.hashfull / 10).toFixed(1)} % utilisée{s.ttSizeMB ? ` (${s.ttSizeMB.toFixed(1)} Mo)` : ''}
                </dd>
              </>
            )}
          </dl>
          <div className="pv" title={s.pv.join(' ')}>
            <span className="muted">PV : </span>
            {pvToSan(fen, s.pv, 16)}
          </div>
          {s.stopped && <div className="muted small">Recherche interrompue : dernière itération complète.</div>}
        </>
      ) : (
        <div className="muted">Aucune recherche.</div>
      )}
    </div>
  );
}
