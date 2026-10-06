import { useEffect, useRef, useState } from 'react';
import type { TournamentRecord } from '../../match/tournament';
import { type ExportBundle, deleteItem, downloadText, exportAll, importBundle, listItems } from '../../storage/db';
import { GamesTable, StatsTiles } from '../components/TournamentResults';
import { fmtElo, fmtPct } from '../format';

/** Section 19 : expériences conservées, export / import JSON. */
export function HistoryView() {
  const [items, setItems] = useState<TournamentRecord[]>([]);
  const [sel, setSel] = useState<TournamentRecord | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const t = await listItems<TournamentRecord>('tournaments');
    setItems(t.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    const c: Record<string, number> = {};
    for (const s of ['configs', 'datasets', 'datasetRuns', 'analyses'] as const) c[s] = (await listItems(s)).length;
    setCounts(c);
  };
  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Expériences enregistrées</h3>
          <div className="toolbar">
            <button className="btn" onClick={async () => downloadText(`chess-truk-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll(), null, 1))}>
              Tout exporter (JSON)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Importer
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const n = await importBundle(JSON.parse(await f.text()) as ExportBundle);
                  setMsg(`${n} éléments importés.`);
                  await reload();
                } catch (err) {
                  setMsg((err as Error).message);
                }
              }}
            />
          </div>
          {msg && <div className="muted small">{msg}</div>}
          <div className="muted small">
            Configurations : {counts.configs ?? 0} · Datasets : {counts.datasets ?? 0} · Analyses de datasets : {counts.datasetRuns ?? 0} ·
            Analyses de parties : {counts.analyses ?? 0}
          </div>
          {items.map((r) => (
            <div key={r.id} className={`list-item ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => setSel(r)}>
              <div>
                <div className="strong small">{r.config.name}</div>
                <div className="muted small">
                  {new Date(r.createdAt).toLocaleString('fr-FR')} · {r.stats.games}/{r.config.games} parties · {r.status}
                  {r.kind === 'ladder-step' ? ` · échelle X=${r.ladderValue}` : ''}
                </div>
              </div>
              <div className="num">
                {fmtPct(r.stats.score)} <span className="muted small">({fmtElo(r.stats.elo)})</span>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="muted small">Aucun tournoi enregistré.</div>}
        </div>
      </section>
      <section className="col-main">
        {sel ? (
          <div className="panel">
            <h3>{sel.config.name}</h3>
            <div className="toolbar">
              <button
                className="btn small"
                onClick={async () => {
                  if (!confirm('Supprimer ce tournoi ?')) return;
                  await deleteItem('tournaments', sel.id);
                  setSel(null);
                  await reload();
                }}
              >
                Supprimer
              </button>
            </div>
            <StatsTiles rec={sel} />
            <details>
              <summary>Configuration complète (reproductibilité)</summary>
              <pre className="mono small json">{JSON.stringify({ config: sel.config, environment: sel.environment, createdAt: sel.createdAt, finishedAt: sel.finishedAt }, null, 2)}</pre>
            </details>
            <GamesTable rec={sel} />
          </div>
        ) : (
          <div className="panel muted">Sélectionnez un tournoi pour voir sa configuration, ses statistiques et ses parties.</div>
        )}
      </section>
    </div>
  );
}
