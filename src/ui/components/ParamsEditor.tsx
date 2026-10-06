import { useState } from 'react';
import {
  EVAL_TERMS,
  EVAL_TERM_LABELS,
  type EngineConfig,
  PIECE_KEYS,
  type PieceKey,
  type Score2,
  cloneConfig,
  defaultEvalParams,
  getByPath,
  setByPath,
} from '../../engine/params';
import { NumField } from './Settings';

const PIECE_FR: Record<PieceKey, string> = { pawn: 'Pion', knight: 'Cavalier', bishop: 'Fou', rook: 'Tour', queen: 'Dame', king: 'Roi' };

function S2({ label, value, onChange, title }: { label: string; value: Score2; onChange: (v: Score2) => void; title?: string }) {
  return (
    <div className="s2" title={title}>
      <span>{label}</span>
      <input type="number" value={value.mg} onChange={(e) => onChange({ ...value, mg: Number(e.target.value) || 0 })} title="Milieu de partie" />
      <input type="number" value={value.eg} onChange={(e) => onChange({ ...value, eg: Number(e.target.value) || 0 })} title="Finale" />
    </div>
  );
}

function RankTable({ label, values, onChange }: { label: string; values: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="rank-table">
      <span>{label}</span>
      <div>
        {values.map((v, i) => (
          <label key={i}>
            <small>R{i + 1}</small>
            <input
              type="number"
              value={v}
              disabled={i === 0 || i === 7}
              onChange={(e) => {
                const n = [...values];
                n[i] = Number(e.target.value) || 0;
                onChange(n);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function PstEditor({ table, onChange }: { table: number[]; onChange: (t: number[]) => void }) {
  const max = Math.max(1, ...table.map(Math.abs));
  return (
    <div className="pst">
      {table.map((v, i) => {
        const f = i % 8;
        const r = 8 - Math.floor(i / 8);
        const a = Math.min(1, Math.abs(v) / max) * 0.55;
        const bg = v > 0 ? `rgba(57,135,229,${a})` : v < 0 ? `rgba(217,89,38,${a})` : 'transparent';
        return (
          <input
            key={i}
            type="number"
            value={v}
            title={`${'abcdefgh'[f]}${r}`}
            style={{ background: bg }}
            onChange={(e) => {
              const n = [...table];
              n[i] = Number(e.target.value) || 0;
              onChange(n);
            }}
          />
        );
      })}
    </div>
  );
}

/** Éditeur complet des paramètres d'évaluation (tous les champs de EvalParams). */
export function ParamsEditor({ config, onChange }: { config: EngineConfig; onChange: (c: EngineConfig) => void }) {
  const [pstPiece, setPstPiece] = useState<PieceKey>('knight');
  const [pstPhase, setPstPhase] = useState<'mg' | 'eg'>('mg');
  const e = config.eval;
  const set = (path: string, value: unknown) => {
    const c = cloneConfig(config);
    setByPath(c, path, value);
    onChange(c);
  };
  const s2 = (path: string, label: string, title?: string) => (
    <S2 label={label} value={getByPath(config, path) as Score2} onChange={(v) => set(path, v)} title={title} />
  );
  const num = (path: string, label: string, title?: string) => (
    <NumField label={label} value={getByPath(config, path) as number} onChange={(v) => set(path, v ?? 0)} title={title} />
  );

  return (
    <div className="params-editor">
      <section className="panel">
        <h3>Composantes actives</h3>
        <div className="toggles grid">
          {EVAL_TERMS.map((t) => (
            <label key={t} className="toggle">
              <input type="checkbox" checked={e.enabled[t] !== false} onChange={(ev) => set(`eval.enabled.${t}`, ev.target.checked)} />
              <span>{EVAL_TERM_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Matériel (cp)</h3>
        <div className="fields3">
          {(['pawn', 'knight', 'bishop', 'rook', 'queen'] as const).map((k) => num(`eval.pieceValues.${k}`, PIECE_FR[k]))}
        </div>
      </section>

      <section className="panel">
        <h3>Pions</h3>
        <RankTable label="Avancement (tout pion, rangée relative)" values={e.pawnAdvancement} onChange={(v) => set('eval.pawnAdvancement', v)} />
        <RankTable label="Pion passé — milieu de partie" values={e.passedPawn.mg} onChange={(v) => set('eval.passedPawn.mg', v)} />
        <RankTable label="Pion passé — finale" values={e.passedPawn.eg} onChange={(v) => set('eval.passedPawn.eg', v)} />
        <div className="s2-head">
          <span />
          <small>MG</small>
          <small>EG</small>
        </div>
        {s2('eval.protectedPassed', 'Pion passé protégé (en plus)')}
        {s2('eval.connectedPawn', 'Pion connecté (phalange ou protégé)')}
        {s2('eval.isolatedPawn', 'Pion isolé')}
        {s2('eval.doubledPawn', 'Pion doublé (pion arrière)')}
        {s2('eval.backwardPawn', 'Pion arriéré')}
        {num('eval.kingPasserProximity', 'Proximité des rois / pion passé (EG, par case)')}
      </section>

      <section className="panel">
        <h3>Mobilité (par case au-delà de la base)</h3>
        <div className="s2-head">
          <span />
          <small>MG</small>
          <small>EG</small>
        </div>
        {(['knight', 'bishop', 'rook', 'queen'] as const).map((k) => (
          <div key={k}>{s2(`eval.mobility.${k}`, PIECE_FR[k])}</div>
        ))}
        <div className="fields3">{(['knight', 'bishop', 'rook', 'queen'] as const).map((k) => num(`eval.mobility.baseline.${k}`, `Base ${PIECE_FR[k]}`))}</div>
      </section>

      <section className="panel">
        <h3>Centre, espace, développement</h3>
        <div className="fields3">
          {num('eval.center.pawnOccupation', 'Pion sur d4/e4/d5/e5 (MG)')}
          {num('eval.center.attack', 'Attaque d’une case centrale (MG)')}
          {num('eval.space', 'Espace, par case (MG)')}
          {num('eval.development.undevelopedMinor', 'Pièce mineure non développée (MG)')}
        </div>
      </section>

      <section className="panel">
        <h3>Sécurité du roi (MG)</h3>
        <div className="fields3">
          {num('eval.kingSafety.shieldRank1', 'Bouclier rangée +1')}
          {num('eval.kingSafety.shieldRank2', 'Bouclier rangée +2')}
          {num('eval.kingSafety.semiOpenFile', 'Colonne semi-ouverte')}
          {num('eval.kingSafety.openFile', 'Colonne ouverte')}
          {num('eval.kingSafety.attackWeights.knight', 'Poids attaque C')}
          {num('eval.kingSafety.attackWeights.bishop', 'Poids attaque F')}
          {num('eval.kingSafety.attackWeights.rook', 'Poids attaque T')}
          {num('eval.kingSafety.attackWeights.queen', 'Poids attaque D')}
          {num('eval.kingSafety.attackScale', 'Échelle (unités² × s / 100)')}
          {num('eval.kingSafety.attackCap', 'Plafond du malus')}
          {num('eval.kingSafety.minAttackers', 'Attaquants minimum')}
        </div>
      </section>

      <section className="panel">
        <h3>Pièces</h3>
        <div className="s2-head">
          <span />
          <small>MG</small>
          <small>EG</small>
        </div>
        {s2('eval.bishopPair', 'Paire de fous')}
        {s2('eval.rookOpenFile', 'Tour colonne ouverte')}
        {s2('eval.rookSemiOpenFile', 'Tour colonne semi-ouverte')}
        {s2('eval.rookOnSeventh', 'Tour en 7e')}
        {s2('eval.outpost.knight', 'Avant-poste cavalier')}
        {s2('eval.outpost.bishop', 'Avant-poste fou')}
        {s2('eval.threats.attackedByPawn', 'Pièce attaquée par un pion')}
        {s2('eval.threats.hanging', 'Pièce attaquée non défendue')}
        {s2('eval.tempo', 'Trait (tempo)')}
      </section>

      <section className="panel">
        <h3>Piece-Square Tables</h3>
        <div className="toolbar">
          <div className="seg">
            {PIECE_KEYS.map((p) => (
              <button key={p} className={pstPiece === p ? 'on' : ''} onClick={() => setPstPiece(p)}>
                {PIECE_FR[p]}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={pstPhase === 'mg' ? 'on' : ''} onClick={() => setPstPhase('mg')}>
              Milieu
            </button>
            <button className={pstPhase === 'eg' ? 'on' : ''} onClick={() => setPstPhase('eg')}>
              Finale
            </button>
          </div>
        </div>
        <div className="muted small">
          Point de vue des blancs : rangée 8 en haut (miroir vertical automatique pour les noirs). Interpolation MG/EG selon la phase.
        </div>
        <PstEditor table={e.psqt[pstPiece][pstPhase]} onChange={(t) => set(`eval.psqt.${pstPiece}.${pstPhase}`, t)} />
        <div className="toolbar">
          <button className="btn small" onClick={() => set(`eval.psqt.${pstPiece}.eg`, [...e.psqt[pstPiece].mg])}>
            Copier MG → EG
          </button>
          <button className="btn small" onClick={() => set(`eval.psqt.${pstPiece}.${pstPhase}`, new Array(64).fill(0))}>
            Mettre à zéro
          </button>
          <button className="btn small" onClick={() => set(`eval.psqt.${pstPiece}`, cloneConfig(defaultEvalParams().psqt[pstPiece]))}>
            Valeurs par défaut
          </button>
        </div>
      </section>
    </div>
  );
}
