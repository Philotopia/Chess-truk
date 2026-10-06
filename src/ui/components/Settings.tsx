import { useState } from 'react';
import type { SearchOptions } from '../../engine/params';
import type { SearchLimits } from '../../engine/search';
import { multiThreadAvailable } from '../../stockfish/browserTransport';
import { STOCKFISH_PRESETS, type StockfishSettings, WASM_LIMITATIONS } from '../../stockfish/presets';
import type { UciLimits } from '../../stockfish/uci';

export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  title,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  title?: string;
}) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder ?? '—'}
        onChange={(e) => {
          const v = e.target.value === '' ? undefined : Number(e.target.value);
          onChange(v === undefined || Number.isNaN(v) ? undefined : v);
        }}
      />
    </label>
  );
}

/** Contraintes de recherche : profondeur / nœuds / temps (la première atteinte arrête la recherche). */
export function TrukLimitsEditor({ limits, onChange }: { limits: SearchLimits; onChange: (l: SearchLimits) => void }) {
  return (
    <div className="fields3">
      <NumField label="Profondeur" value={limits.depth} min={1} max={64} onChange={(depth) => onChange({ ...limits, depth })} />
      <NumField label="Nœuds" value={limits.nodes} min={1} step={1000} onChange={(nodes) => onChange({ ...limits, nodes })} />
      <NumField label="Temps (ms)" value={limits.timeMs} min={10} step={100} onChange={(timeMs) => onChange({ ...limits, timeMs })} />
    </div>
  );
}

export function SfLimitsEditor({ limits, onChange }: { limits: UciLimits; onChange: (l: UciLimits) => void }) {
  return (
    <div className="fields3">
      <NumField label="Profondeur" value={limits.depth} min={1} max={60} onChange={(depth) => onChange({ ...limits, depth })} />
      <NumField label="Nœuds" value={limits.nodes} min={1} step={1000} onChange={(nodes) => onChange({ ...limits, nodes })} />
      <NumField label="Temps (ms)" value={limits.movetime} min={10} step={100} onChange={(movetime) => onChange({ ...limits, movetime })} />
    </div>
  );
}

const OPT_LABELS: [keyof SearchOptions, string, string][] = [
  ['useTT', 'Table de transposition', 'Mémorise les positions déjà évaluées.'],
  ['quiescence', 'Quiescence', 'Prolonge les captures aux feuilles (évite l’effet d’horizon).'],
  ['mvvLva', 'Tri MVV-LVA', 'Captures triées : victime la plus forte, attaquant le plus faible.'],
  ['killers', 'Killer moves', 'Coups calmes ayant provoqué une coupure au même ply.'],
  ['history', 'History heuristic', 'Coups calmes souvent bons, toutes branches confondues.'],
  ['pvs', 'Principal Variation Search', 'Fenêtre nulle pour les coups non principaux.'],
  ['aspiration', 'Fenêtres d’aspiration', 'Fenêtre étroite autour du score précédent (prof. ≥ 4).'],
  ['nullMove', 'Null move pruning', 'Passer son tour : si cela suffit, la branche est coupée.'],
  ['lmr', 'Late move reductions', 'Réduit la profondeur des coups calmes tardifs.'],
  ['checkExtension', 'Extension d’échec', 'Prolonge d’un ply les positions en échec.'],
  ['lmrLog', 'LMR logarithmique (V2)', 'Réduction ∝ log(profondeur)·log(rang du coup), ajustée par l’historique.'],
  ['nullMoveAdaptive', 'Null move adaptatif (V2)', 'R = 3 + profondeur/4 + marge d’évaluation.'],
  ['rfp', 'Reverse futility pruning (V2)', 'Éval statique ≫ bêta à faible profondeur : coupure immédiate.'],
  ['futility', 'Futility pruning (V2)', 'Coups calmes ignorés quand éval + marge ≤ alpha.'],
  ['lmp', 'Late move pruning (V2)', 'Coups calmes tardifs ignorés à faible profondeur.'],
  ['razoring', 'Razoring (V2)', 'Éval très basse : vérification directe par quiescence.'],
  ['see', 'SEE (V2)', 'Évaluation statique des échanges : captures perdantes triées en dernier et élaguées.'],
  ['qsTT', 'TT en quiescence (V2)', 'La table de transposition sert aussi dans la quiescence.'],
  ['iir', 'Internal iterative reduction (V2)', 'Sans coup en table : profondeur − 1.'],
  ['countermove', 'Contre-coup (V2)', 'Coup ayant réfuté le coup adverse précédent, essayé tôt.'],
];

export function SearchOptionsEditor({ opts, onChange }: { opts: SearchOptions; onChange: (o: SearchOptions) => void }) {
  return (
    <div className="toggles">
      {OPT_LABELS.map(([k, label, help]) => (
        <label key={k} className="toggle" title={help}>
          <input type="checkbox" checked={opts[k] as boolean} onChange={(e) => onChange({ ...opts, [k]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
      <div className="fields3">
        <NumField label="TT (Mo)" value={opts.ttSizeMB} min={1} max={512} onChange={(v) => onChange({ ...opts, ttSizeMB: v ?? 16 })} />
        <NumField
          label="Fenêtre asp. (cp)"
          value={opts.aspirationWindow}
          min={5}
          max={500}
          onChange={(v) => onChange({ ...opts, aspirationWindow: v ?? 35 })}
        />
      </div>
    </div>
  );
}

export function StockfishSettingsEditor({
  settings,
  onChange,
  limits,
  onLimits,
}: {
  settings: StockfishSettings;
  onChange: (s: StockfishSettings) => void;
  limits?: UciLimits;
  onLimits?: (l: UciLimits) => void;
}) {
  const [showLim, setShowLim] = useState(false);
  const mt = multiThreadAvailable();
  return (
    <div className="sf-settings">
      {limits && onLimits && (
        <label className="field">
          <span>Préréglage</span>
          <select
            value=""
            onChange={(e) => {
              const p = STOCKFISH_PRESETS.find((x) => x.id === e.target.value);
              if (p) {
                onChange({ ...p.settings, flavor: settings.flavor, threads: settings.threads, hashMB: settings.hashMB });
                onLimits(p.limits);
              }
            }}
          >
            <option value="">— choisir —</option>
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
      )}
      {limits && onLimits && <SfLimitsEditor limits={limits} onChange={onLimits} />}
      <div className="fields3">
        <label className="field">
          <span>Variante</span>
          <select value={settings.flavor} onChange={(e) => onChange({ ...settings, flavor: e.target.value as StockfishSettings['flavor'] })}>
            <option value="lite-single">lite, 1 thread</option>
            <option value="lite" disabled={!mt}>
              lite, multi-thread{mt ? '' : ' (indisponible)'}
            </option>
          </select>
        </label>
        <NumField
          label="Threads"
          value={settings.threads}
          min={1}
          max={32}
          onChange={(v) => onChange({ ...settings, threads: v ?? 1 })}
          title="Effectif seulement avec la variante multi-thread"
        />
        <NumField label="Hash (Mo)" value={settings.hashMB} min={1} max={1024} onChange={(v) => onChange({ ...settings, hashMB: v ?? 16 })} />
      </div>
      <div className="fields3">
        <NumField
          label="Skill Level"
          value={settings.skillLevel ?? undefined}
          min={0}
          max={20}
          placeholder="20"
          onChange={(v) => onChange({ ...settings, skillLevel: v === undefined ? null : v })}
        />
        <label className="field">
          <span>Limiter (UCI_Elo)</span>
          <input type="checkbox" checked={settings.limitStrength} onChange={(e) => onChange({ ...settings, limitStrength: e.target.checked })} />
        </label>
        <NumField label="UCI_Elo" value={settings.elo} min={1320} max={3190} step={10} onChange={(v) => onChange({ ...settings, elo: v ?? 1320 })} />
      </div>
      <button className="link" onClick={() => setShowLim(!showLim)}>
        {showLim ? 'Masquer' : 'Voir'} les limitations de la version WASM
      </button>
      {showLim && (
        <ul className="limitations">
          {WASM_LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li>Cette page : {mt ? 'cross-origin isolated, multi-thread disponible' : 'multi-thread indisponible (pas de SharedArrayBuffer)'} ; {navigator.hardwareConcurrency ?? '?'} cœurs logiques.</li>
        </ul>
      )}
    </div>
  );
}
