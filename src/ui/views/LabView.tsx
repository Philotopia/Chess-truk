import { useState } from 'react';
import { type EngineConfig, cloneConfig, diffConfigs, normalizeConfig } from '../../engine/params';
import type { SearchLimits } from '../../engine/search';
import { OPENING_BOOK } from '../../match/openings';
import { defaultAdjudication } from '../../match/types';
import { describeLimits } from '../../stockfish/presets';
import { ParamsEditor } from '../components/ParamsEditor';
import { NumField, SearchOptionsEditor, TrukLimitsEditor } from '../components/Settings';
import { GamesTable, LiveGame, StatsTiles } from '../components/TournamentResults';
import { useLab } from '../state';
import { useSavedConfigs } from '../useSavedConfigs';
import { useTournament } from '../useTournament';
import { AdjudicationEditor } from './TournamentView';

/** Section 14 : Experiment Lab — deux configurations de Truk s'affrontent. */
export function LabView() {
  const lab = useLab();
  const saved = useSavedConfigs();
  const t = useTournament();
  const [a, setA] = useState<EngineConfig>(() => ({ ...cloneConfig(lab.config), name: 'Engine A' }));
  const [b, setB] = useState<EngineConfig>(() => {
    const c = cloneConfig(lab.config);
    c.name = 'Engine B';
    c.eval.pieceValues.knight = 310;
    c.eval.pieceValues.bishop = 340;
    c.eval.pawnAdvancement[5] = 70;
    return c;
  });
  const [editing, setEditing] = useState<'A' | 'B'>('B');
  const [limits, setLimits] = useState<SearchLimits>({ nodes: 5000 });
  const [games, setGames] = useState(40);
  const [adj, setAdj] = useState(defaultAdjudication());
  const [json, setJson] = useState<string | null>(null);
  const diff = diffConfigs({ ...a, name: '' }, { ...b, name: '' });
  const cur = editing === 'A' ? a : b;
  const setCur = editing === 'A' ? setA : setB;

  const loadInto = (id: string) => {
    const s = saved.items.find((x) => x.id === id);
    if (s) setCur({ ...cloneConfig(s.config) });
  };

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Expérience A / B</h3>
          <div className="lab-names">
            <label className="field">
              <span>Nom A</span>
              <input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Nom B</span>
              <input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
            </label>
          </div>
          <h4>Différences ({diff.length})</h4>
          {diff.length === 0 ? (
            <div className="muted small">Configurations identiques : le match mesurerait seulement le bruit.</div>
          ) : (
            <table className="table small">
              <thead>
                <tr>
                  <th>Paramètre</th>
                  <th className="num">A</th>
                  <th className="num">B</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.path}>
                    <td className="mono">{d.path}</td>
                    <td className="num">{String(d.a)}</td>
                    <td className="num">{String(d.b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Conditions du match (identiques pour A et B)</h4>
          <TrukLimitsEditor limits={limits} onChange={setLimits} />
          <div className="fields3">
            <NumField label="Parties" value={games} min={2} onChange={(v) => setGames(v ?? 2)} />
          </div>
          <AdjudicationEditor adj={adj} onChange={setAdj} />
          {!limits.timeMs && games > OPENING_BOOK.length * 2 && (
            <div className="note warn">Au-delà de {OPENING_BOOK.length * 2} parties en nœuds/profondeur, les parties se répètent à l’identique.</div>
          )}
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={t.running || diff.length === 0}
              onClick={() =>
                void t.run({
                  name: `Lab : ${a.name} vs ${b.name}`,
                  a: { kind: 'truk', label: `${a.name} (${describeLimits(limits)})`, config: a, limits },
                  b: { kind: 'truk', label: `${b.name} (${describeLimits(limits)})`, config: b, limits },
                  games,
                  openings: 'book',
                  openingOffset: 0,
                  maxPlies: 300,
                  adjudication: adj,
                })
              }
            >
              Lancer A vs B
            </button>
            <button className="btn" disabled={!t.running} onClick={t.stop}>
              Arrêter
            </button>
          </div>
          {t.error && <div className="error">{t.error}</div>}
        </div>
        {t.live && <LiveGame live={t.live} />}
      </section>
      <section className="col-main">
        {t.record && (
          <div className="panel">
            <h3>Résultat : A = {a.name}, B = {b.name}</h3>
            <StatsTiles rec={t.record} />
            <div className="conclusion">
              {t.record.stats.los !== null && t.record.stats.los > 0.95
                ? `${a.name} est très probablement plus fort (LOS ${(t.record.stats.los * 100).toFixed(1)} %).`
                : t.record.stats.los !== null && t.record.stats.los < 0.05
                  ? `${b.name} est très probablement plus fort (LOS de A ${(t.record.stats.los * 100).toFixed(1)} %).`
                  : 'Différence non significative à 95 % : jouer plus de parties.'}
            </div>
            <GamesTable rec={t.record} />
          </div>
        )}
        <div className="panel">
          <div className="toolbar">
            <div className="seg">
              <button className={editing === 'A' ? 'on' : ''} onClick={() => setEditing('A')}>
                Éditer A
              </button>
              <button className={editing === 'B' ? 'on' : ''} onClick={() => setEditing('B')}>
                Éditer B
              </button>
            </div>
            <button className="btn small" onClick={() => setCur({ ...cloneConfig(lab.config), name: cur.name })}>
              Copier la config courante
            </button>
            <select value="" onChange={(e) => loadInto(e.target.value)}>
              <option value="">Charger une config sauvegardée…</option>
              {saved.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => setJson(JSON.stringify(cur, null, 2))}>
              JSON
            </button>
          </div>
          {json !== null && (
            <div>
              <textarea className="mono pgn" rows={12} value={json} onChange={(e) => setJson(e.target.value)} />
              <div className="toolbar">
                <button
                  className="btn small"
                  onClick={() => {
                    try {
                      setCur(normalizeConfig(JSON.parse(json)));
                      setJson(null);
                    } catch (err) {
                      alert((err as Error).message);
                    }
                  }}
                >
                  Appliquer
                </button>
                <button className="btn small" onClick={() => setJson(null)}>
                  Fermer
                </button>
              </div>
            </div>
          )}
          <h3>Recherche ({editing})</h3>
          <SearchOptionsEditor opts={cur.search} onChange={(search) => setCur({ ...cur, search })} />
        </div>
        <ParamsEditor config={cur} onChange={setCur} />
      </section>
    </div>
  );
}
