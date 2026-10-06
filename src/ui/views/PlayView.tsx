import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateFen } from '../../core/fen';
import { Game, REASON_FR } from '../../core/game';
import { exportPgn, parsePgn } from '../../core/pgn';
import { START_FEN } from '../../core/types';
import { createBrowserPlayer } from '../../match/factoryBrowser';
import { toWhitePov } from '../../match/compare';
import type { LiveInfo, Player } from '../../match/types';
import { describeLimits } from '../../stockfish/presets';
import { downloadText } from '../../storage/db';
import { Board } from '../components/Board';
import { type ChartSeries, EvalChart } from '../components/EvalChart';
import { EvalBar } from '../components/EvalBar';
import { MoveList, NavButtons } from '../components/MoveList';
import { SearchInfoView, type SearchSummary } from '../components/SearchInfoView';
import { WhyPanel } from '../components/WhyPanel';
import { sfAnalyze } from '../services';
import { useLab } from '../state';
import { EngineSidebar } from './EngineSidebar';

type Kind = 'human' | 'truk' | 'stockfish';
const KIND_LABEL: Record<Kind, string> = { human: 'Humain', truk: 'Truk (notre moteur)', stockfish: 'Stockfish' };

const MODES: { id: string; label: string; white: Kind; black: Kind }[] = [
  { id: 'A', label: 'A · Humain (blancs) vs Truk', white: 'human', black: 'truk' },
  { id: 'A2', label: 'A · Truk vs Humain (noirs)', white: 'truk', black: 'human' },
  { id: 'B', label: 'B · Truk vs Stockfish', white: 'truk', black: 'stockfish' },
  { id: 'C', label: 'C · Stockfish vs Truk', white: 'stockfish', black: 'truk' },
  { id: 'SS', label: 'Calibration · Stockfish vs Stockfish', white: 'stockfish', black: 'stockfish' },
  { id: 'TT', label: 'Truk vs Truk', white: 'truk', black: 'truk' },
  { id: 'HH', label: 'Humain vs Humain (libre)', white: 'human', black: 'human' },
];

interface MoveMeta {
  by: Kind;
  cpWhite: number | null;
  mateWhite: number | null;
  depth: number;
  nodes: number;
  timeMs: number;
  sfCpWhite?: number | null;
}

export function PlayView() {
  const lab = useLab();
  const [modeId, setModeId] = useState('A');
  const mode = MODES.find((m) => m.id === modeId)!;
  const [startFen, setStartFen] = useState(START_FEN);
  const gameRef = useRef(new Game(START_FEN));
  const [version, setVersion] = useState(0);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState<{ side: 'w' | 'b'; kind: Kind; info: LiveInfo | null } | null>(null);
  const [lastSearch, setLastSearch] = useState<SearchSummary | null>(null);
  const [meta, setMeta] = useState<MoveMeta[]>([]);
  const [flip, setFlip] = useState(false);
  const [sfWatch, setSfWatch] = useState(false);
  const [fenInput, setFenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sfEvals, setSfEvals] = useState<(number | null)[]>([]);
  const players = useRef<{ w: Player | null; b: Player | null; gen: number }>({ w: null, b: null, gen: 0 });
  const busy = useRef(false);

  const game = gameRef.current;
  const total = game.moves.length;
  const ply = viewPly === null ? total : Math.min(viewPly, total);
  const fen = game.fenAt(ply);
  const status = game.status();
  const sideToMove: 'w' | 'b' = game.pos.side === 0 ? 'w' : 'b';
  const kindToMove = sideToMove === 'w' ? mode.white : mode.black;

  const disposePlayers = () => {
    players.current.w?.dispose();
    players.current.b?.dispose();
    players.current = { w: null, b: null, gen: players.current.gen + 1 };
  };
  useEffect(() => () => disposePlayers(), []);

  const newGame = useCallback(
    (fenStart = startFen) => {
      disposePlayers();
      busy.current = false;
      gameRef.current = new Game(fenStart);
      setMeta([]);
      setViewPly(null);
      setLastSearch(null);
      setThinking(null);
      setError(null);
      setRunning(false);
      setSfEvals([]);
      setVersion((v) => v + 1);
    },
    [startFen],
  );

  const getPlayer = async (side: 'w' | 'b', kind: Kind): Promise<Player | null> => {
    if (kind === 'human') return null;
    const cur = players.current[side];
    if (cur) return cur;
    const p =
      kind === 'truk'
        ? await createBrowserPlayer({ kind: 'truk', label: lab.config.name, config: lab.config, limits: lab.trukLimits })
        : await createBrowserPlayer({ kind: 'stockfish', label: 'Stockfish', settings: lab.sfSettings, limits: lab.sfLimits });
    p.newGame();
    players.current[side] = p;
    return p;
  };

  // Les réglages changent : les moteurs seront recréés au prochain coup.
  useEffect(() => {
    disposePlayers();
    busy.current = false;
    setThinking(null);
    setVersion((v) => v + 1);
  }, [lab.config, lab.trukLimits, lab.sfSettings, lab.sfLimits, modeId]);

  const afterMove = (m: MoveMeta) => {
    setMeta((prev) => [...prev, m]);
    setVersion((v) => v + 1);
  };

  // Boucle des moteurs.
  useEffect(() => {
    if (status.over || kindToMove === 'human' || busy.current) return;
    const autoplay = mode.white !== 'human' && mode.black !== 'human';
    if (autoplay && !running) return;
    const gen = players.current.gen;
    busy.current = true;
    (async () => {
      try {
        const p = await getPlayer(sideToMove, kindToMove);
        if (!p || gen !== players.current.gen) return;
        setThinking({ side: sideToMove, kind: kindToMove, info: null });
        const dec = await p.think(game.startFen, game.uciMoves(), (info) => {
          if (gen === players.current.gen) setThinking({ side: sideToMove, kind: kindToMove, info });
        });
        if (gen !== players.current.gen) return;
        if (!dec.uci) throw new Error(`${KIND_LABEL[kindToMove]} n’a renvoyé aucun coup`);
        const wtm = sideToMove === 'w';
        const cpWhite = dec.mate === null && dec.scoreCp !== null ? (wtm ? dec.scoreCp : -dec.scoreCp) : null;
        const mateWhite = dec.mate === null ? null : wtm ? dec.mate : -dec.mate;
        setLastSearch({
          depth: dec.depth,
          seldepth: dec.seldepth,
          nodes: dec.nodes,
          nps: dec.timeMs > 0 ? (dec.nodes * 1000) / dec.timeMs : 0,
          timeMs: dec.timeMs,
          cpWhite,
          mateWhite,
          bestMove: dec.uci,
          pv: dec.pv,
        });
        game.playUci(dec.uci);
        afterMove({ by: kindToMove, cpWhite, mateWhite, depth: dec.depth, nodes: dec.nodes, timeMs: dec.timeMs });
      } catch (e) {
        setError((e as Error).message);
        setRunning(false);
      } finally {
        if (gen === players.current.gen) {
          busy.current = false;
          setThinking(null);
        }
      }
    })();
  }, [version, running, modeId]);

  // Évaluation Stockfish de chaque nouvelle position (option).
  useEffect(() => {
    if (!sfWatch) return;
    const idx = total;
    const fenNow = game.fen;
    let cancelled = false;
    sfAnalyze(lab.sfSettings, { depth: Math.min(lab.sfLimits.depth ?? 12, 14) }, fenNow, []).then((r) => {
      if (cancelled) return;
      const v = r.bestMove ? toWhitePov(r.scoreCp, r.mate, fenNow.split(' ')[1] === 'w') : null;
      setSfEvals((prev) => {
        const n = [...prev];
        n[idx] = v;
        return n;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [version, sfWatch]);

  const onHumanMove = (uci: string) => {
    if (viewPly !== null && viewPly !== total) return;
    try {
      game.playUci(uci);
      afterMove({ by: 'human', cpWhite: null, mateWhite: null, depth: 0, nodes: 0, timeMs: 0 });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const undo = () => {
    disposePlayers();
    busy.current = false;
    setThinking(null);
    let n = 1;
    // En partie humain vs moteur, on revient au dernier coup humain.
    if (mode.white !== mode.black && (mode.white === 'human' || mode.black === 'human')) {
      const humanSide = mode.white === 'human' ? 0 : 1;
      n = game.pos.side === humanSide ? 2 : 1;
    }
    for (let i = 0; i < n && game.moves.length; i++) game.undo();
    setMeta((m) => m.slice(0, game.moves.length));
    setViewPly(null);
    setRunning(false);
    setVersion((v) => v + 1);
  };

  const loadFen = () => {
    const f = fenInput.trim();
    const v = validateFen(f);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setStartFen(f);
    newGame(f);
  };

  const loadPgn = (text: string) => {
    try {
      const g = parsePgn(text);
      disposePlayers();
      gameRef.current = g.game;
      setStartFen(g.game.startFen);
      setMeta(g.game.moves.map(() => ({ by: 'human' as Kind, cpWhite: null, mateWhite: null, depth: 0, nodes: 0, timeMs: 0 })));
      setViewPly(null);
      setRunning(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pgnText = useMemo(() => {
    const comments: Record<number, string> = {};
    meta.forEach((m, i) => {
      if (m.by !== 'human' && (m.cpWhite !== null || m.mateWhite !== null))
        comments[i] = `${m.mateWhite !== null ? '#' + m.mateWhite : (m.cpWhite! / 100).toFixed(2)} d${m.depth}`;
    });
    return exportPgn(
      game,
      { White: KIND_LABEL[mode.white], Black: KIND_LABEL[mode.black], Event: 'Partie libre' },
      status.over ? status.result : '*',
      comments,
    );
  }, [version, meta, modeId]);

  const lastMove = ply > 0 ? { from: game.moves[ply - 1].uci.slice(0, 2), to: game.moves[ply - 1].uci.slice(2, 4) } : null;

  const series: ChartSeries[] = [
    { name: 'Truk', color: 'var(--series-1)', values: [null, ...meta.map((m) => (m.by === 'truk' ? m.cpWhite ?? (m.mateWhite !== null ? Math.sign(m.mateWhite) * 1000 : null) : null))] },
    {
      name: 'Stockfish',
      color: 'var(--series-2)',
      values: Array.from({ length: total + 1 }, (_, i) => {
        if (sfEvals[i] !== undefined) return sfEvals[i];
        const m = meta[i - 1];
        return m && m.by === 'stockfish' ? m.cpWhite ?? (m.mateWhite !== null ? Math.sign(m.mateWhite) * 1000 : null) : null;
      }),
    },
  ];

  const humanCanMove = kindToMove === 'human' && !status.over && ply === total;
  const autoplay = mode.white !== 'human' && mode.black !== 'human';
  const liveSummary: SearchSummary | null = thinking?.info
    ? {
        depth: thinking.info.depth,
        nodes: thinking.info.nodes,
        nps: thinking.info.nps,
        timeMs: 0,
        cpWhite: thinking.info.scoreCp === null ? null : thinking.side === 'w' ? thinking.info.scoreCp : -thinking.info.scoreCp,
        mateWhite: thinking.info.mate === null ? null : thinking.side === 'w' ? thinking.info.mate : -thinking.info.mate,
        bestMove: thinking.info.pv[0] ?? null,
        pv: thinking.info.pv,
      }
    : null;
  const barSource = liveSummary ?? lastSearch;

  return (
    <div className="layout3">
      <section className="col-board">
        <div className="board-row">
          <EvalBar cp={barSource?.cpWhite ?? null} mate={barSource?.mateWhite ?? null} flipped={flip} />
          <Board
            fen={fen}
            orientation={flip ? 'black' : 'white'}
            lastMove={lastMove}
            interactive={humanCanMove}
            onMove={onHumanMove}
            arrows={liveSummary?.bestMove ? [{ from: liveSummary.bestMove.slice(0, 2), to: liveSummary.bestMove.slice(2, 4), color: 'var(--series-1)' }] : []}
          />
        </div>
        <div className="status-line">
          {status.over ? (
            <b>
              Partie terminée : {status.result} ({REASON_FR[status.reason]})
            </b>
          ) : thinking ? (
            <span>
              {KIND_LABEL[thinking.kind]} réfléchit ({thinking.side === 'w' ? 'blancs' : 'noirs'})…
            </span>
          ) : humanCanMove ? (
            <span>À vous de jouer ({sideToMove === 'w' ? 'blancs' : 'noirs'}).</span>
          ) : autoplay && !running ? (
            <span>En pause.</span>
          ) : (
            <span>&nbsp;</span>
          )}
          {status.inCheck && !status.over && <span className="tag warn">échec</span>}
        </div>
        <div className="toolbar">
          <NavButtons ply={ply} max={total} onChange={(p) => setViewPly(p === total ? null : p)} />
          <button className="btn small" onClick={() => setFlip(!flip)} title="Retourner l’échiquier">
            ⇅
          </button>
          <button className="btn small" onClick={undo} disabled={!total}>
            Annuler
          </button>
        </div>
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        <div className="panel">
          <h3>Mode de jeu</h3>
          <select value={modeId} onChange={(e) => setModeId(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="muted small">
            Blancs : {KIND_LABEL[mode.white]}
            {mode.white === 'truk' && ` (${describeLimits(lab.trukLimits)})`}
            {mode.white === 'stockfish' && ` (${describeLimits(lab.sfLimits)})`} · Noirs : {KIND_LABEL[mode.black]}
            {mode.black === 'truk' && ` (${describeLimits(lab.trukLimits)})`}
            {mode.black === 'stockfish' && ` (${describeLimits(lab.sfLimits)})`}
          </div>
          <div className="toolbar">
            <button className="btn primary" onClick={() => newGame()}>
              Nouvelle partie
            </button>
            {autoplay && (
              <button className="btn" onClick={() => setRunning(!running)} disabled={status.over}>
                {running ? 'Pause' : 'Lancer'}
              </button>
            )}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={sfWatch} onChange={(e) => setSfWatch(e.target.checked)} />
            <span>Évaluer chaque position avec Stockfish (analyse séparée)</span>
          </label>
        </div>
        <div className="panel">
          <h3>Position de départ (FEN)</h3>
          <div className="row">
            <input className="grow mono" placeholder={START_FEN} value={fenInput} onChange={(e) => setFenInput(e.target.value)} />
            <button className="btn small" onClick={loadFen}>
              Charger
            </button>
          </div>
          <div className="mono small selectable">{fen}</div>
        </div>
      </section>

      <section className="col-main">
        <SearchInfoView
          title={thinking ? `${KIND_LABEL[thinking.kind]} — en cours` : 'Dernière recherche'}
          fen={thinking ? game.fen : game.fenAt(Math.max(0, total - 1))}
          s={liveSummary ?? lastSearch}
          running={!!thinking}
        />
        <div className="panel">
          <h3>Évolution de l’évaluation</h3>
          <EvalChart series={series} current={ply} onSelect={(p) => setViewPly(p >= total ? null : p)} />
        </div>
        <div className="panel">
          <h3>Coups</h3>
          <MoveList
            moves={game.moves.map((m, i) => ({
              san: m.san,
              note: meta[i] && meta[i].by !== 'human' ? `${KIND_LABEL[meta[i].by]} d${meta[i].depth} ${meta[i].nodes} nœuds` : undefined,
            }))}
            startFullmove={Number(game.startFen.split(' ')[5] || 1)}
            whiteFirst={game.startFen.split(' ')[1] === 'w'}
            current={ply}
            onSelect={(p) => setViewPly(p === total ? null : p)}
          />
        </div>
        <WhyPanel fen={fen} params={lab.config.eval} />
        <div className="panel">
          <h3>PGN</h3>
          <textarea className="mono pgn" value={pgnText} readOnly rows={5} />
          <div className="toolbar">
            <button className="btn small" onClick={() => downloadText('partie.pgn', pgnText, 'application/x-chess-pgn')}>
              Télécharger
            </button>
            <button
              className="btn small"
              onClick={() => {
                const t = prompt('Coller un PGN :');
                if (t) loadPgn(t);
              }}
            >
              Importer un PGN
            </button>
          </div>
        </div>
      </section>

      <EngineSidebar />
    </div>
  );
}
