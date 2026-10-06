import { useState } from 'react';
import type { SearchLimits } from '../../engine/search';
import { OPENING_BOOK } from '../../match/openings';
import type { TournamentConfig } from '../../match/tournament';
import { type AdjudicationSettings, defaultAdjudication, type PlayerSpec } from '../../match/types';
import { STOCKFISH_PRESETS, type StockfishSettings, describeLimits } from '../../stockfish/presets';
import type { UciLimits } from '../../stockfish/uci';
import { NumField, StockfishSettingsEditor, TrukLimitsEditor } from '../components/Settings';
import { GamesTable, LiveGame, StatsTiles } from '../components/TournamentResults';
import { useLab } from '../state';
import { useSavedConfigs } from '../useSavedConfigs';
import { useTournament } from '../useTournament';

export function AdjudicationEditor({ adj, onChange }: { adj: AdjudicationSettings; onChange: (a: AdjudicationSettings) => void }) {
  return (
    <div>
      <label className="toggle">
        <input type="checkbox" checked={adj.enabled} onChange={(e) => onChange({ ...adj, enabled: e.target.checked })} />
        <span>Adjudication (accélère les tournois ; désactivée = parties jouées jusqu’au bout)</span>
      </label>
      {adj.enabled && (
        <div className="fields3">
          <NumField label="Abandon si ≥ cp" value={adj.resignCp} onChange={(v) => onChange({ ...adj, resignCp: v ?? 1000 })} />
          <NumField label="… pendant coups" value={adj.resignMoves} onChange={(v) => onChange({ ...adj, resignMoves: v ?? 4 })} />
          <NumField label="Nulle si |éval| ≤" value={adj.drawCp} onChange={(v) => onChange({ ...adj, drawCp: v ?? 10 })} />
          <NumField label="… pendant coups" value={adj.drawMoves} onChange={(v) => onChange({ ...adj, drawMoves: v ?? 12 })} />
          <NumField label="… après ½-coup" value={adj.drawMinPly} onChange={(v) => onChange({ ...adj, drawMinPly: v ?? 80 })} />
        </div>
      )}
    </div>
  );
}

/** Mode D : tournoi automatique Truk vs Stockfish (ou vs une configuration Truk sauvegardée). */
export function TournamentView() {
  const lab = useLab();
  const saved = useSavedConfigs();
  const t = useTournament();
  const [games, setGames] = useState(20);
  const [trukLimits, setTrukLimits] = useState<SearchLimits>({ nodes: 10000 });
  const [oppKind, setOppKind] = useState<'stockfish' | 'truk'>('stockfish');
  const [presetId, setPresetId] = useState('sf-nodes-10000');
  const [sfSettings, setSfSettings] = useState<StockfishSettings>(lab.sfSettings);
  const [sfLimits, setSfLimits] = useState<UciLimits>({ nodes: 10000 });
  const [oppConfigId, setOppConfigId] = useState('');
  const [openings, setOpenings] = useState<'book' | 'startpos'>('book');
  const [offset, setOffset] = useState(0);
  const [maxPlies, setMaxPlies] = useState(300);
  const [adj, setAdj] = useState(defaultAdjudication());
  const [sameBudget, setSameBudget] = useState(true);

  const preset = STOCKFISH_PRESETS.find((p) => p.id === presetId);

  const buildConfig = (): TournamentConfig | null => {
    const a: PlayerSpec = { kind: 'truk', label: `${lab.config.name} (${describeLimits(trukLimits)})`, config: lab.config, limits: trukLimits };
    let b: PlayerSpec;
    if (oppKind === 'stockfish') {
      const limits = sameBudget && trukLimits.nodes ? { nodes: trukLimits.nodes } : sfLimits;
      b = { kind: 'stockfish', label: `Stockfish (${describeLimits(limits)}${sfSettings.skillLevel !== null ? `, skill ${sfSettings.skillLevel}` : ''}${sfSettings.limitStrength ? `, Elo ${sfSettings.elo}` : ''})`, settings: sfSettings, limits, presetId, refElo: sfSettings.limitStrength ? sfSettings.elo : undefined };
    } else {
      const c = saved.items.find((x) => x.id === oppConfigId);
      if (!c) return null;
      b = { kind: 'truk', label: `${c.config.name} (${describeLimits(trukLimits)})`, config: c.config, limits: trukLimits };
    }
    return { name: `${a.label} vs ${b.label}`, a, b, games, openings, openingOffset: offset, maxPlies, adjudication: adj };
  };

  const deterministic = oppKind === 'truk' || (sfSettings.skillLevel === null && !sfSettings.limitStrength && !(sfLimits.movetime && !sameBudget));
  const trukDeterministic = !trukLimits.timeMs;
  const dupWarn = openings === 'startpos' ? games > 2 : games > OPENING_BOOK.length * 2;

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Joueur A — Truk (configuration courante : {lab.config.name})</h3>
          <TrukLimitsEditor limits={trukLimits} onChange={setTrukLimits} />
          <div className="muted small">Exemples : 100 / 500 / 1000 / 5000 ms par coup, ou un budget en nœuds identique pour les deux camps.</div>
        </div>
        <div className="panel">
          <h3>Joueur B</h3>
          <div className="seg">
            <button className={oppKind === 'stockfish' ? 'on' : ''} onClick={() => setOppKind('stockfish')}>
              Stockfish
            </button>
            <button className={oppKind === 'truk' ? 'on' : ''} onClick={() => setOppKind('truk')}>
              Truk (config sauvegardée)
            </button>
          </div>
          {oppKind === 'stockfish' ? (
            <>
              <label className="field">
                <span>Préréglage</span>
                <select
                  value={presetId}
                  onChange={(e) => {
                    setPresetId(e.target.value);
                    const p = STOCKFISH_PRESETS.find((x) => x.id === e.target.value);
                    if (p) {
                      setSfSettings({ ...p.settings, flavor: sfSettings.flavor, threads: sfSettings.threads, hashMB: sfSettings.hashMB });
                      setSfLimits(p.limits);
                      setSameBudget(false);
                    }
                  }}
                >
                  {['Niveau', 'Elo', 'Profondeur', 'Nœuds', 'Temps'].map((g) => (
                    <optgroup key={g} label={g}>
                      {STOCKFISH_PRESETS.filter((p) => p.group === g).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={sameBudget} onChange={(e) => setSameBudget(e.target.checked)} />
                <span>Même budget en nœuds que Truk (comparaison à calcul égal)</span>
              </label>
              <StockfishSettingsEditor settings={sfSettings} onChange={setSfSettings} limits={sameBudget ? undefined : sfLimits} onLimits={sameBudget ? undefined : setSfLimits} />
              {preset && !preset.deterministic && <div className="note">Ce préréglage n’est pas déterministe (aléa interne de Stockfish ou limite en temps).</div>}
            </>
          ) : (
            <label className="field">
              <span>Configuration</span>
              <select value={oppConfigId} onChange={(e) => setOppConfigId(e.target.value)}>
                <option value="">— choisir (onglet Paramètres → Enregistrer) —</option>
                {saved.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="panel">
          <h3>Tournoi</h3>
          <div className="fields3">
            <NumField label="Parties" value={games} min={1} max={10000} onChange={(v) => setGames(v ?? 2)} />
            <NumField label="Max ½-coups" value={maxPlies} min={20} onChange={(v) => setMaxPlies(v ?? 300)} />
            <NumField label="Décalage ouvertures" value={offset} min={0} onChange={(v) => setOffset(v ?? 0)} />
          </div>
          <label className="field">
            <span>Ouvertures</span>
            <select value={openings} onChange={(e) => setOpenings(e.target.value as 'book' | 'startpos')}>
              <option value="book">Livre ({OPENING_BOOK.length} ouvertures équilibrées, chacune jouée 2× couleurs inversées)</option>
              <option value="startpos">Position initiale uniquement</option>
            </select>
          </label>
          <AdjudicationEditor adj={adj} onChange={setAdj} />
          <div className="muted small">
            Alternance des couleurs : A a les blancs aux parties impaires. Avec {games} parties : {Math.ceil(games / 2)} avec les blancs,{' '}
            {Math.floor(games / 2)} avec les noirs.
          </div>
          {dupWarn && deterministic && trukDeterministic && (
            <div className="note warn">
              Moteurs déterministes : au-delà de {openings === 'startpos' ? 2 : OPENING_BOOK.length * 2} parties, les ouvertures se répètent et
              produisent des parties identiques (ce qui gonfle artificiellement la significativité).
            </div>
          )}
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={t.running}
              onClick={() => {
                const c = buildConfig();
                if (c) void t.run(c);
              }}
            >
              Lancer le tournoi
            </button>
            <button className="btn" disabled={!t.running} onClick={t.stop}>
              Arrêter (après le coup en cours)
            </button>
          </div>
          {t.error && <div className="error">{t.error}</div>}
        </div>
      </section>
      <section className="col-main">
        {t.live && <LiveGame live={t.live} />}
        {t.record ? (
          <div className="panel">
            <h3>
              {t.record.config.name} — {t.running ? 'en cours' : t.record.status === 'aborted' ? 'interrompu' : 'terminé'}
            </h3>
            <StatsTiles rec={t.record} />
            <GamesTable rec={t.record} />
          </div>
        ) : (
          !t.running && (
            <div className="panel muted">
              Configurez les deux joueurs puis lancez le tournoi. Chaque partie terminée est enregistrée (onglet Historique) avec la configuration
              complète des moteurs, les PGN et les statistiques, pour garantir la reproductibilité.
            </div>
          )
        )}
      </section>
    </div>
  );
}
