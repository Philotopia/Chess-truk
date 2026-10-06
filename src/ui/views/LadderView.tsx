import { useState } from 'react';
import { type TournamentRecord, newId } from '../../match/tournament';
import { defaultAdjudication } from '../../match/types';
import { NODE_LADDER, type StockfishSettings, describeLimits } from '../../stockfish/presets';
import { NumField, StockfishSettingsEditor } from '../components/Settings';
import { LiveGame } from '../components/TournamentResults';
import { fmtElo, fmtInt, fmtPct } from '../format';
import { useLab } from '../state';
import { useTournament } from '../useTournament';

type Axis = 'nodes' | 'sfDepth';

/**
 * Section 10 : échelle de difficulté. Pour chaque valeur X, un mini-tournoi
 * Truk (X × k nœuds) vs Stockfish (X nœuds) — ou Stockfish à profondeur X.
 */
export function LadderView() {
  const lab = useLab();
  const t = useTournament();
  const [axis, setAxis] = useState<Axis>('nodes');
  const [values, setValues] = useState(NODE_LADDER.slice(0, 5).join(', '));
  const [gamesPerStep, setGamesPerStep] = useState(10);
  const [multiplier, setMultiplier] = useState(1);
  const [trukNodesForDepth, setTrukNodesForDepth] = useState(20000);
  const [sfSettings, setSfSettings] = useState<StockfishSettings>({ ...lab.sfSettings, skillLevel: null, limitStrength: false });
  const [rows, setRows] = useState<TournamentRecord[]>([]);
  const [stopAll, setStopAll] = useState(false);

  const parsed = values
    .split(/[,;\s]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x > 0);

  const run = async () => {
    setRows([]);
    setStopAll(false);
    const ladderId = newId();
    const acc: TournamentRecord[] = [];
    for (const x of parsed) {
      const trukLimits = axis === 'nodes' ? { nodes: Math.round(x * multiplier) } : { nodes: trukNodesForDepth };
      const sfLimits = axis === 'nodes' ? { nodes: x } : { depth: x };
      const a = { kind: 'truk' as const, label: `${lab.config.name} (${describeLimits(trukLimits)})`, config: lab.config, limits: trukLimits };
      const b = { kind: 'stockfish' as const, label: `Stockfish (${describeLimits(sfLimits)})`, settings: sfSettings, limits: sfLimits };
      const rec = await t.run(
        { name: `Échelle ${axis === 'nodes' ? 'nœuds' : 'profondeur SF'} = ${x}`, a, b, games: gamesPerStep, openings: 'book', openingOffset: 0, maxPlies: 300, adjudication: defaultAdjudication() },
        { kind: 'ladder-step', ladderId, ladderValue: x },
      );
      if (!rec) break;
      acc.push(rec);
      setRows([...acc]);
      if (rec.status === 'aborted' || t.aborted()) break;
    }
  };

  const best = rows.filter((r) => r.stats.score >= 0.5).map((r) => r.ladderValue ?? 0);
  const current = t.record;

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Échelle de difficulté</h3>
          <div className="seg">
            <button className={axis === 'nodes' ? 'on' : ''} onClick={() => { setAxis('nodes'); setValues(NODE_LADDER.slice(0, 5).join(', ')); }}>
              Budget en nœuds (X pour les deux)
            </button>
            <button className={axis === 'sfDepth' ? 'on' : ''} onClick={() => { setAxis('sfDepth'); setValues('1, 2, 3, 4, 5, 6'); }}>
              Profondeur Stockfish
            </button>
          </div>
          <label className="field">
            <span>{axis === 'nodes' ? 'Valeurs de X (nœuds par coup)' : 'Profondeurs Stockfish'}</span>
            <input value={values} onChange={(e) => setValues(e.target.value)} />
          </label>
          <div className="fields3">
            <NumField label="Parties / palier" value={gamesPerStep} min={2} onChange={(v) => setGamesPerStep(v ?? 10)} />
            {axis === 'nodes' ? (
              <NumField label="Multiplicateur Truk" value={multiplier} min={0.01} step={0.5} onChange={(v) => setMultiplier(v ?? 1)} title="Truk reçoit X × k nœuds (k = 1 : budget identique)" />
            ) : (
              <NumField label="Nœuds Truk" value={trukNodesForDepth} min={100} step={1000} onChange={(v) => setTrukNodesForDepth(v ?? 20000)} />
            )}
          </div>
          <h4>Réglages Stockfish</h4>
          <StockfishSettingsEditor settings={sfSettings} onChange={setSfSettings} />
          <div className="toolbar">
            <button className="btn primary" disabled={t.running || parsed.length === 0} onClick={() => void run()}>
              Lancer l’échelle
            </button>
            <button className="btn" disabled={!t.running} onClick={() => { setStopAll(true); t.stop(); }}>
              Arrêter
            </button>
          </div>
          {stopAll && <div className="muted small">Arrêt demandé.</div>}
          {t.error && <div className="error">{t.error}</div>}
          <div className="muted small">
            Question expérimentale : « Truk bat Stockfish lorsque les deux disposent de X nœuds par coup » — jusqu’à quel X ? Les nœuds ne
            sont pas strictement comparables (Stockfish compte aussi ses nœuds de quiescence, élague beaucoup plus et évalue par NNUE) :
            les nœuds réellement consommés sont affichés.
          </div>
        </div>
      </section>
      <section className="col-main">
        {t.live && <LiveGame live={t.live} />}
        <div className="panel">
          <h3>Résultats par palier</h3>
          <table className="table">
            <thead>
              <tr>
                <th>X</th>
                <th className="num">V</th>
                <th className="num">N</th>
                <th className="num">D</th>
                <th className="num">Score Truk</th>
                <th className="num">Elo Truk − SF</th>
                <th className="num">Nœuds moy. Truk</th>
                <th className="num">Nœuds moy. SF</th>
                <th className="num">Prof. Truk / SF</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, ...(t.running && current && !rows.some((r) => r.id === current.id) ? [current] : [])].map((r) => (
                <tr key={r.id} className={r.stats.score >= 0.5 ? 'win-row' : ''}>
                  <td>{fmtInt(r.ladderValue ?? 0)}{r.status === 'running' ? ' …' : ''}</td>
                  <td className="num">{r.stats.wins}</td>
                  <td className="num">{r.stats.draws}</td>
                  <td className="num">{r.stats.losses}</td>
                  <td className="num strong">{fmtPct(r.stats.score)}</td>
                  <td className="num">
                    {fmtElo(r.stats.elo)} <span className="muted small">[{fmtElo(r.stats.eloLow)} ; {fmtElo(r.stats.eloHigh)}]</span>
                  </td>
                  <td className="num">{fmtInt(r.stats.a.avgNodes)}</td>
                  <td className="num">{fmtInt(r.stats.b.avgNodes)}</td>
                  <td className="num">
                    {r.stats.a.avgDepth.toFixed(1)} / {r.stats.b.avgDepth.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 0 && (
            <div className="conclusion">
              {best.length
                ? `Truk obtient ≥ 50 % jusqu’à X = ${fmtInt(Math.max(...best))} (sur ${rows[0].config.games} parties par palier — vérifier l’intervalle de confiance).`
                : 'Truk n’atteint 50 % à aucun palier testé.'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
