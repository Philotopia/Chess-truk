import { defaultEngineConfig } from '../../engine/params';
import { NumField, SearchOptionsEditor, StockfishSettingsEditor, TrukLimitsEditor } from '../components/Settings';
import { useLab } from '../state';

const PIECES: ['pawn' | 'knight' | 'bishop' | 'rook' | 'queen', string][] = [
  ['pawn', 'Pion'],
  ['knight', 'Cavalier'],
  ['bishop', 'Fou'],
  ['rook', 'Tour'],
  ['queen', 'Dame'],
];

/** Colonne de droite : réglages rapides du moteur Truk et de Stockfish. */
export function EngineSidebar() {
  const lab = useLab();
  const c = lab.config;
  return (
    <aside className="col-side">
      <div className="panel">
        <h3>Truk — contraintes</h3>
        <TrukLimitsEditor limits={lab.trukLimits} onChange={lab.setTrukLimits} />
        <div className="muted small">La première limite atteinte arrête la recherche (la profondeur 1 est toujours terminée).</div>
      </div>
      <div className="panel">
        <h3>Truk — valeurs des pièces</h3>
        <div className="fields3">
          {PIECES.map(([k, label]) => (
            <NumField
              key={k}
              label={label}
              value={c.eval.pieceValues[k]}
              onChange={(v) => lab.setConfig({ ...c, eval: { ...c.eval, pieceValues: { ...c.eval.pieceValues, [k]: v ?? 0 } } })}
            />
          ))}
        </div>
        <div className="muted small">Tous les paramètres (tables, bonus, PST) : onglet « Paramètres ».</div>
      </div>
      <div className="panel">
        <h3>Truk — recherche</h3>
        <SearchOptionsEditor opts={c.search} onChange={(search) => lab.setConfig({ ...c, search })} />
        <button className="btn small" onClick={() => lab.setConfig({ ...defaultEngineConfig(c.name), eval: c.eval })}>
          Options par défaut
        </button>
      </div>
      <div className="panel">
        <h3>Stockfish</h3>
        <StockfishSettingsEditor settings={lab.sfSettings} onChange={lab.setSfSettings} limits={lab.sfLimits} onLimits={lab.setSfLimits} />
      </div>
    </aside>
  );
}
