import { useRef, useState } from 'react';
import { Game } from '../../core/game';
import { parsePgn } from '../../core/pgn';
import type { SearchLimits } from '../../engine/search';
import {
  type GameAnalysisSummary,
  type MoveAnalysis,
  type PositionComparison,
  analyzeMoves,
  comparePosition,
  summarize,
  toWhitePov,
} from '../../match/compare';
import { newId } from '../../match/tournament';
import type { UciLimits } from '../../stockfish/uci';
import { putItem } from '../../storage/db';
import { Board } from '../components/Board';
import { EvalChart } from '../components/EvalChart';
import { SfLimitsEditor, TrukLimitsEditor } from '../components/Settings';
import { fmtCp, fmtWhite, fmtPct, uciToSanSafe } from '../format';
import { sfAnalyze, trukAnalyze } from '../services';
import { useLab } from '../state';

const CLS_FR: Record<string, string> = { best: 'meilleur', good: 'bon', inaccuracy: 'imprécision', mistake: 'erreur', blunder: 'gaffe' };

/** Section 13 : comparaison Truk / Stockfish sur une partie complète. */
export function GameAnalysisView() {
  const lab = useLab();
  const [pgn, setPgn] = useState('');
  const [trukLimits, setTrukLimits] = useState<SearchLimits>({ nodes: 50000 });
  const [sfLimits, setSfLimits] = useState<UciLimits>({ depth: 12 });
  const [game, setGame] = useState<Game | null>(null);
  const [positions, setPositions] = useState<PositionComparison[]>([]);
  const [moves, setMoves] = useState<MoveAnalysis[]>([]);
  const [summary, setSummary] = useState<GameAnalysisSummary | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef(false);

  const run = async () => {
    setError(null);
    let g: Game;
    try {
      g = parsePgn(pgn).game;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setGame(g);
    setPositions([]);
    setMoves([]);
    setSummary(null);
    abort.current = false;
    const uci = g.uciMoves();
    const out: PositionComparison[] = [];
    setProgress({ done: 0, total: uci.length + 1 });
    for (let i = 0; i <= uci.length; i++) {
      if (abort.current) break;
      const fen = g.fenAt(i);
      const wtm = fen.split(' ')[1] === 'w';
      const hist = uci.slice(0, i);
      try {
        const [t, s] = await Promise.all([
          trukAnalyze(lab.config, trukLimits, g.startFen, hist),
          sfAnalyze(lab.sfSettings, sfLimits, g.startFen, hist),
        ]);
        // Position terminale : score déterminé par la règle (mat = −MATE pour le camp au trait).
        const tv = { scoreWhite: toWhitePov(t.mate === null ? t.score : null, t.mate, wtm), mate: t.mate, bestMove: t.bestMove, depth: t.completedDepth, nodes: t.nodes, timeMs: t.timeMs, pv: t.pv };
        const sv = { scoreWhite: toWhitePov(s.scoreCp, s.mate, wtm), mate: s.mate, bestMove: s.bestMove, depth: s.depth, nodes: s.nodes, timeMs: s.timeMs, pv: s.pv };
        out.push(comparePosition(fen, tv, sv));
      } catch (e) {
        setError((e as Error).message);
        break;
      }
      setPositions([...out]);
      setProgress({ done: i + 1, total: uci.length + 1 });
    }
    const mv = analyzeMoves(out, uci, g.startFen.split(' ')[1] === 'w');
    const sm = summarize(out, mv);
    setMoves(mv);
    setSummary(sm);
    setProgress(null);
    if (out.length) {
      await putItem('analyses', {
        id: newId(),
        createdAt: new Date().toISOString(),
        pgn,
        trukConfig: lab.config,
        trukLimits,
        sfSettings: lab.sfSettings,
        sfLimits,
        positions: out,
        moves: mv,
        summary: sm,
      });
    }
  };

  const side = (label: string, s: GameAnalysisSummary['white']) => (
    <tr>
      <td>{label}</td>
      <td className="num">{s.moves}</td>
      <td className="num">{s.acpl.toFixed(1)}</td>
      <td className="num">{s.inaccuracies}</td>
      <td className="num">{s.mistakes}</td>
      <td className="num">{s.blunders}</td>
      <td className="num">{fmtPct(s.sfAgreement)}</td>
    </tr>
  );

  const fenSel = game ? game.fenAt(Math.min(sel, game.moves.length)) : null;
  return (
    <div className="layout2">
      <section className="col-board">
        {fenSel && <Board fen={fenSel} lastMove={sel > 0 && game ? { from: game.moves[sel - 1].uci.slice(0, 2), to: game.moves[sel - 1].uci.slice(2, 4) } : null} />}
        <div className="panel">
          <h3>Partie à analyser (PGN)</h3>
          <textarea className="mono pgn" rows={8} value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder="1. e4 e5 2. Nf3 …" />
          <h4>Truk</h4>
          <TrukLimitsEditor limits={trukLimits} onChange={setTrukLimits} />
          <h4>Stockfish</h4>
          <SfLimitsEditor limits={sfLimits} onChange={setSfLimits} />
          <div className="toolbar">
            <button className="btn primary" onClick={run} disabled={!!progress}>
              Analyser la partie
            </button>
            <button className="btn" onClick={() => (abort.current = true)} disabled={!progress}>
              Arrêter
            </button>
          </div>
          {progress && (
            <div className="progress">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              <span>
                {progress.done}/{progress.total} positions
              </span>
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      </section>
      <section className="col-main">
        {summary && (
          <div className="panel">
            <h3>Synthèse</h3>
            <div className="stat-tiles">
              <div className="tile">
                <span>Accord meilleur coup</span>
                <b>{fmtPct(summary.bestMoveAgreement)}</b>
              </div>
              <div className="tile">
                <span>Δ moyen (Truk − SF)</span>
                <b>{fmtCp(summary.meanDelta)}</b>
              </div>
              <div className="tile">
                <span>Erreur absolue moyenne</span>
                <b>{(summary.meanAbsError / 100).toFixed(2)}</b>
              </div>
              <div className="tile">
                <span>Positions</span>
                <b>{summary.positions}</b>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Camp</th>
                  <th className="num">Coups</th>
                  <th className="num">ACPL</th>
                  <th className="num">Imprécisions</th>
                  <th className="num">Erreurs</th>
                  <th className="num">Gaffes</th>
                  <th className="num">= coup SF</th>
                </tr>
              </thead>
              <tbody>
                {side('Blancs', summary.white)}
                {side('Noirs', summary.black)}
              </tbody>
            </table>
            <div className="muted small">
              Perte en centipawns selon Stockfish (évaluations plafonnées à ±10 pions). Imprécision ≥ 50, erreur ≥ 100, gaffe ≥ 300 cp.
            </div>
          </div>
        )}
        {positions.length > 0 && (
          <div className="panel">
            <h3>Évaluations</h3>
            <EvalChart
              series={[
                { name: 'Truk', color: 'var(--series-1)', values: positions.map((p) => p.truk.scoreWhite) },
                { name: 'Stockfish', color: 'var(--series-2)', values: positions.map((p) => p.sf.scoreWhite) },
              ]}
              current={sel}
              onSelect={setSel}
            />
            <table className="table small clickable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Joué</th>
                  <th className="num">Truk</th>
                  <th className="num">SF</th>
                  <th className="num">Δ</th>
                  <th>Coup Truk</th>
                  <th>Coup SF</th>
                  <th className="num">CPL</th>
                  <th>Qualité</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const m = moves[i];
                  return (
                    <tr key={i} className={sel === i ? 'sel' : ''} onClick={() => setSel(i)}>
                      <td>{i}</td>
                      <td>{game && i < game.moves.length ? game.moves[i].san : '—'}</td>
                      <td className="num">{fmtWhite(p.truk.scoreWhite)}</td>
                      <td className="num">{fmtWhite(p.sf.scoreWhite)}</td>
                      <td className="num">{Math.abs(p.delta) >= 5000 ? 'mat' : fmtCp(p.delta)}</td>
                      <td className={p.sameMove ? 'pos' : ''}>{uciToSanSafe(p.fen, p.truk.bestMove)}</td>
                      <td>{uciToSanSafe(p.fen, p.sf.bestMove)}</td>
                      <td className="num">{m ? m.cpl.toFixed(0) : ''}</td>
                      <td className={m ? `cls-${m.cls}` : ''}>{m ? CLS_FR[m.cls] : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!positions.length && (
          <div className="panel muted">
            Collez un PGN (par exemple une partie exportée depuis l’onglet Jouer ou un tournoi) puis lancez l’analyse. Chaque position est
            analysée par Truk et Stockfish avec les limites indiquées ; les résultats sont enregistrés dans l’historique local.
          </div>
        )}
      </section>
    </div>
  );
}
