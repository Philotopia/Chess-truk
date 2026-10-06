import { useMemo, useRef, useState } from 'react';
import { validateFen } from '../../core/fen';
import { Game } from '../../core/game';
import { START_FEN } from '../../core/types';
import type { SearchResult } from '../../engine/search';
import { toWhitePov } from '../../match/compare';
import type { UciResult } from '../../stockfish/uci';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { MoveList, NavButtons } from '../components/MoveList';
import { SearchInfoView, type SearchSummary } from '../components/SearchInfoView';
import { WhyPanel } from '../components/WhyPanel';
import { fmtScore, uciToSanSafe } from '../format';
import { analysisTruk, sfAnalyze, sfStop, trukAnalyze } from '../services';
import { useLab } from '../state';
import { EngineSidebar } from './EngineSidebar';

function trukSummary(r: SearchResult, wtm: boolean): SearchSummary {
  return {
    depth: r.completedDepth || r.depth,
    seldepth: r.seldepth,
    nodes: r.nodes,
    nps: r.nps,
    timeMs: r.timeMs,
    cpWhite: r.mate === null ? (wtm ? r.score : -r.score) : null,
    mateWhite: r.mate === null ? null : wtm ? r.mate : -r.mate,
    bestMove: r.bestMove,
    pv: r.pv,
    hashfull: r.hashfull,
    ttSizeMB: r.ttSizeMB || undefined,
    stopped: r.stopped,
  };
}

function sfSummary(r: UciResult, wtm: boolean): SearchSummary {
  return {
    depth: r.depth,
    seldepth: r.seldepth,
    nodes: r.nodes,
    nps: r.nps,
    timeMs: r.timeMs,
    cpWhite: r.mate === null ? (r.scoreCp === null ? null : wtm ? r.scoreCp : -r.scoreCp) : null,
    mateWhite: r.mate === null ? null : wtm ? r.mate : -r.mate,
    bestMove: r.bestMove,
    pv: r.pv,
    hashfull: r.hashfull,
  };
}

/** Modes E (analyse d'une position) et F (comparaison directe Truk / Stockfish). */
export function AnalysisView() {
  const lab = useLab();
  const gameRef = useRef(new Game(START_FEN));
  const [version, setVersion] = useState(0);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [fenInput, setFenInput] = useState('');
  const [truk, setTruk] = useState<SearchSummary | null>(null);
  const [sf, setSf] = useState<SearchSummary | null>(null);
  const [trukRunning, setTrukRunning] = useState(false);
  const [sfRunning, setSfRunning] = useState(false);
  const [analyzedFen, setAnalyzedFen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const game = gameRef.current;
  void version;
  const total = game.moves.length;
  const ply = viewPly === null ? total : viewPly;
  const fen = game.fenAt(ply);
  const wtm = fen.split(' ')[1] === 'w';

  const resetResults = () => {
    setTruk(null);
    setSf(null);
    setAnalyzedFen(null);
  };

  const loadFen = (f: string) => {
    const v = validateFen(f);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    gameRef.current = new Game(f);
    setViewPly(null);
    resetResults();
    setError(null);
    setVersion((x) => x + 1);
  };

  const onMove = (uci: string) => {
    // Jouer depuis une position passée tronque la suite.
    while (game.moves.length > ply) game.undo();
    game.playUci(uci);
    setViewPly(null);
    resetResults();
    setVersion((x) => x + 1);
  };

  const moves = game.uciMoves().slice(0, ply);

  const runTruk = async () => {
    setTrukRunning(true);
    setAnalyzedFen(fen);
    try {
      const r = await trukAnalyze(lab.config, lab.trukLimits, game.startFen, moves, (i) =>
        setTruk({
          depth: i.depth,
          seldepth: i.seldepth,
          nodes: i.nodes,
          nps: i.nps,
          timeMs: i.timeMs,
          cpWhite: i.mate === null ? (wtm ? i.score : -i.score) : null,
          mateWhite: i.mate === null ? null : wtm ? i.mate : -i.mate,
          bestMove: i.pv[0] ?? null,
          pv: i.pv,
          hashfull: i.hashfull,
        }),
      );
      setTruk(trukSummary(r, wtm));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrukRunning(false);
    }
  };

  const runSf = async () => {
    setSfRunning(true);
    setAnalyzedFen(fen);
    try {
      const r = await sfAnalyze(lab.sfSettings, lab.sfLimits, game.startFen, moves, (i) =>
        setSf(sfSummary({ ...i, bestMove: i.pv[0] ?? null, ponder: null }, wtm)),
      );
      setSf(sfSummary(r, wtm));
    } catch (e) {
      setError(`Stockfish : ${(e as Error).message}`);
    } finally {
      setSfRunning(false);
    }
  };

  const runBoth = () => {
    void runTruk();
    void runSf();
  };

  const stop = () => {
    analysisTruk().stop();
    void sfStop();
  };

  // Position au bout de la PV de Truk : son évaluation statique explique le score de recherche.
  const pvLeafFen = useMemo(() => {
    if (!truk || !analyzedFen || truk.pv.length === 0) return null;
    const g = new Game(analyzedFen);
    for (const u of truk.pv) {
      try {
        g.playUci(u);
      } catch {
        break;
      }
    }
    return g.fen;
  }, [truk, analyzedFen]);

  const showResults = analyzedFen === fen;
  const t = showResults ? truk : null;
  const s = showResults ? sf : null;
  const tScore = t ? (t.mateWhite !== null ? toWhitePov(null, t.mateWhite, true) : t.cpWhite) : null;
  const sScore = s ? (s.mateWhite !== null ? toWhitePov(null, s.mateWhite, true) : s.cpWhite) : null;
  const delta = tScore !== null && sScore !== null ? tScore - sScore : null;
  const arrows = [
    ...(t?.bestMove ? [{ from: t.bestMove.slice(0, 2), to: t.bestMove.slice(2, 4), color: 'var(--series-1)' }] : []),
    ...(s?.bestMove ? [{ from: s.bestMove.slice(0, 2), to: s.bestMove.slice(2, 4), color: 'var(--series-2)' }] : []),
  ];

  return (
    <div className="layout3">
      <section className="col-board">
        <div className="board-row">
          <EvalBar cp={t?.cpWhite ?? s?.cpWhite ?? null} mate={t?.mateWhite ?? s?.mateWhite ?? null} flipped={flip} />
          <Board
            fen={fen}
            orientation={flip ? 'black' : 'white'}
            interactive
            onMove={onMove}
            lastMove={ply > 0 ? { from: game.moves[ply - 1].uci.slice(0, 2), to: game.moves[ply - 1].uci.slice(2, 4) } : null}
            arrows={arrows}
          />
        </div>
        <div className="toolbar">
          <NavButtons ply={ply} max={total} onChange={(p) => setViewPly(p === total ? null : p)} />
          <button className="btn small" onClick={() => setFlip(!flip)}>
            ⇅
          </button>
        </div>
        <div className="panel">
          <h3>Position (FEN)</h3>
          <div className="row">
            <input className="grow mono" value={fenInput} placeholder="Coller une FEN…" onChange={(e) => setFenInput(e.target.value)} />
            <button className="btn small" onClick={() => loadFen(fenInput.trim())}>
              Charger
            </button>
            <button className="btn small" onClick={() => loadFen(START_FEN)}>
              Initiale
            </button>
          </div>
          <div className="mono small selectable">{fen}</div>
          {error && (
            <div className="error" onClick={() => setError(null)}>
              {error}
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Coups joués</h3>
          <MoveList
            moves={game.moves.map((m) => ({ san: m.san }))}
            startFullmove={Number(game.startFen.split(' ')[5] || 1)}
            whiteFirst={game.startFen.split(' ')[1] === 'w'}
            current={ply}
            onSelect={(p) => setViewPly(p === total ? null : p)}
          />
        </div>
      </section>

      <section className="col-main">
        <div className="panel">
          <div className="toolbar">
            <button className="btn primary" onClick={runBoth} disabled={trukRunning || sfRunning}>
              Analyser (Truk + Stockfish)
            </button>
            <button className="btn" onClick={runTruk} disabled={trukRunning}>
              Truk seul
            </button>
            <button className="btn" onClick={runSf} disabled={sfRunning}>
              Stockfish seul
            </button>
            <button className="btn" onClick={stop} disabled={!trukRunning && !sfRunning}>
              Stop
            </button>
          </div>
        </div>
        <div className="panel compare">
          <h3>Comparaison directe (mode F)</h3>
          <div className="compare-grid">
            <div>
              <div className="muted">Notre moteur</div>
              <div className="big-score" style={{ color: 'var(--series-1)' }}>
                {t ? fmtScore(t.cpWhite, t.mateWhite) : '—'}
              </div>
              <div className="strong">{t ? uciToSanSafe(fen, t.bestMove) : ''}</div>
            </div>
            <div>
              <div className="muted">Stockfish</div>
              <div className="big-score" style={{ color: 'var(--series-2)' }}>
                {s ? fmtScore(s.cpWhite, s.mateWhite) : '—'}
              </div>
              <div className="strong">{s ? uciToSanSafe(fen, s.bestMove) : ''}</div>
            </div>
            <div>
              <div className="muted">Δ évaluation</div>
              <div className="big-score">{delta === null ? '—' : `${Math.abs(delta) >= 5000 ? 'mat' : Math.round(Math.abs(delta)) + ' cp'}`}</div>
              <div className="muted small">{delta === null ? '' : delta > 0 ? 'Truk plus optimiste (blancs)' : delta < 0 ? 'Truk plus pessimiste (blancs)' : 'identique'}</div>
            </div>
            <div>
              <div className="muted">Même meilleur coup</div>
              <div className={`big-score ${t && s ? (t.bestMove === s.bestMove ? 'pos' : 'neg') : ''}`}>
                {t && s && !trukRunning && !sfRunning ? (t.bestMove === s.bestMove ? 'OUI' : 'NON') : '—'}
              </div>
            </div>
          </div>
          <div className="muted small">Flèche bleue : Truk · flèche orange : Stockfish. Scores du point de vue des blancs.</div>
        </div>
        <div className="two-cols">
          <SearchInfoView title="Truk" fen={fen} s={t} running={trukRunning} />
          <SearchInfoView title="Stockfish" fen={fen} s={s} running={sfRunning} />
        </div>
        <WhyPanel fen={fen} params={lab.config.eval} title="Pourquoi ? (évaluation statique de la position)" />
        {pvLeafFen && showResults && (
          <WhyPanel
            fen={pvLeafFen}
            params={lab.config.eval}
            title="Pourquoi ce score de recherche ? (position au bout de la PV)"
          />
        )}
      </section>
      <EngineSidebar />
    </div>
  );
}
