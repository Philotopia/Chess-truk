import { useEffect, useRef, useState } from 'react';
import { parseFen } from '../../core/fen';
import type { SearchLimits } from '../../engine/search';
import { evaluate } from '../../engine/evaluate';
import { toWhitePov } from '../../match/compare';
import { type Dataset, type DatasetResult, datasetResultsToCsv, importPositions } from '../../match/dataset';
import { newId } from '../../match/tournament';
import type { UciLimits } from '../../stockfish/uci';
import { deleteItem, downloadText, listItems, putItem } from '../../storage/db';
import { Board } from '../components/Board';
import { NumField, SfLimitsEditor, TrukLimitsEditor } from '../components/Settings';
import { fmtCp, fmtWhite, fmtInt, fmtPct, uciToSanSafe } from '../format';
import { sfAnalyze, trukAnalyze } from '../services';
import { useLab } from '../state';

// Petit jeu d'exemple : positions tactiques dont la solution a été vérifiée avec Stockfish.
const SAMPLE = `# Exemples (EPD : 4 champs + bm)
6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Rd8#; id "mat en 1";
r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - bm Re8+; id "mat en 2 (colonne)";
r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - bm Nf6+; id "mat en 2 (sacrifice)";
rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - bm Bxg5; id "dame en prise";
k7/8/8/2Q5/8/8/8/K7 w - - am Qb6; id "éviter le pat";
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1
`;

interface DatasetRun {
  id: string;
  datasetId: string;
  datasetName: string;
  createdAt: string;
  trukConfig: unknown;
  trukLimits: SearchLimits;
  sfLimits: UciLimits | null;
  results: DatasetResult[];
}

/** Section 16 : jeux de positions, analyse comparée et export. */
export function DatasetView() {
  const lab = useLab();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selId, setSelId] = useState('');
  const [text, setText] = useState(SAMPLE);
  const [name, setName] = useState('Exemples');
  const [every, setEvery] = useState(6);
  const [skip, setSkip] = useState(8);
  const [report, setReport] = useState<string | null>(null);
  const [trukLimits, setTrukLimits] = useState<SearchLimits>({ nodes: 20000 });
  const [sfLimits, setSfLimits] = useState<UciLimits>({ depth: 12 });
  const [useSf, setUseSf] = useState(true);
  const [results, setResults] = useState<DatasetResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [view, setView] = useState<string | null>(null);
  const abort = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => setDatasets((await listItems<Dataset>('datasets')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  useEffect(() => {
    void reload();
  }, []);
  const sel = datasets.find((d) => d.id === selId) ?? null;

  const doImport = async () => {
    const r = importPositions(text, { pgnEvery: every, pgnSkip: skip });
    setReport(`${r.positions.length} positions importées, ${r.errors.length} erreur(s).${r.errors.length ? ' ' + r.errors.slice(0, 5).join(' · ') : ''}`);
    if (!r.positions.length) return;
    const d: Dataset = { id: newId(), name: name || 'Dataset', createdAt: new Date().toISOString(), positions: r.positions };
    await putItem('datasets', d);
    await reload();
    setSelId(d.id);
  };

  const run = async () => {
    if (!sel) return;
    abort.current = false;
    const out: DatasetResult[] = [];
    setResults([]);
    for (let i = 0; i < sel.positions.length; i++) {
      if (abort.current) break;
      setProgress(i);
      const p = sel.positions[i];
      const wtm = p.fen.split(' ')[1] === 'w';
      const [t, s] = await Promise.all([
        trukAnalyze(lab.config, trukLimits, p.fen, []),
        useSf ? sfAnalyze(lab.sfSettings, sfLimits, p.fen, []) : Promise.resolve(null),
      ]);
      const tW = toWhitePov(t.mate === null ? t.score : null, t.mate, wtm);
      const sW = s ? toWhitePov(s.scoreCp, s.mate, wtm) : null;
      let solved: boolean | null = null;
      if (p.bestMoves?.length) solved = !!t.bestMove && p.bestMoves.includes(t.bestMove);
      else if (p.avoidMoves?.length) solved = !!t.bestMove && !p.avoidMoves.includes(t.bestMove);
      out.push({
        fen: p.fen,
        id: p.id,
        staticEval: evaluate(parseFen(p.fen), lab.config.eval),
        trukScore: tW,
        trukMate: t.mate,
        trukMove: t.bestMove,
        trukDepth: t.completedDepth,
        trukNodes: t.nodes,
        trukTimeMs: t.timeMs,
        sfScore: sW,
        sfMate: s?.mate ?? null,
        sfMove: s?.bestMove ?? null,
        sfDepth: s?.depth ?? 0,
        sfNodes: s?.nodes ?? 0,
        sfTimeMs: s?.timeMs ?? 0,
        delta: sW === null ? null : tW - sW,
        sameMove: s ? t.bestMove === s.bestMove : null,
        solved,
      });
      setResults([...out]);
    }
    setProgress(null);
    const runRec: DatasetRun = {
      id: newId(),
      datasetId: sel.id,
      datasetName: sel.name,
      createdAt: new Date().toISOString(),
      trukConfig: lab.config,
      trukLimits,
      sfLimits: useSf ? sfLimits : null,
      results: out,
    };
    await putItem('datasetRuns', runRec);
  };

  const cap = (x: number) => Math.max(-1000, Math.min(1000, x));
  const withSf = results.filter((r) => r.sfScore !== null && r.sfMove !== null);
  const mae = withSf.length ? withSf.reduce((s, r) => s + Math.abs(cap(r.trukScore) - cap(r.sfScore!)), 0) / withSf.length : null;
  const agree = withSf.length ? withSf.filter((r) => r.sameMove).length / withSf.length : null;
  const tests = results.filter((r) => r.solved !== null);
  const solveRate = tests.length ? tests.filter((r) => r.solved).length / tests.length : null;

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Importer des positions</h3>
          <div className="muted small">FEN (une par ligne), EPD avec opérations bm/am/id, ou PGN (positions échantillonnées).</div>
          <textarea className="mono pgn" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn small" onClick={() => fileRef.current?.click()}>
              Charger un fichier…
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".fen,.epd,.pgn,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setText(await f.text());
                  setName(f.name.replace(/\.\w+$/, ''));
                }
              }}
            />
          </div>
          <div className="fields3">
            <label className="field">
              <span>Nom</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <NumField label="PGN : tous les n ½-coups" value={every} min={1} onChange={(v) => setEvery(v ?? 6)} />
            <NumField label="PGN : ignorer n ½-coups" value={skip} min={0} onChange={(v) => setSkip(v ?? 8)} />
          </div>
          <button className="btn primary" onClick={doImport}>
            Créer le dataset
          </button>
          {report && <div className="muted small">{report}</div>}
        </div>
        <div className="panel">
          <h3>Datasets</h3>
          {datasets.map((d) => (
            <div key={d.id} className={`list-item ${d.id === selId ? 'sel' : ''}`} onClick={() => setSelId(d.id)}>
              <span>
                {d.name} <span className="muted small">({d.positions.length} positions)</span>
              </span>
              <span>
                <button className="link" onClick={(e) => { e.stopPropagation(); downloadText(`${d.name}.json`, JSON.stringify(d, null, 2)); }}>
                  JSON
                </button>{' '}
                <button className="link" onClick={async (e) => { e.stopPropagation(); if (confirm(`Supprimer ${d.name} ?`)) { await deleteItem('datasets', d.id); await reload(); } }}>
                  ✕
                </button>
              </span>
            </div>
          ))}
          {datasets.length === 0 && <div className="muted small">Aucun dataset.</div>}
        </div>
        {view && <Board fen={view} />}
      </section>
      <section className="col-main">
        <div className="panel">
          <h3>Analyse du dataset {sel ? `« ${sel.name} »` : ''}</h3>
          <h4>Truk</h4>
          <TrukLimitsEditor limits={trukLimits} onChange={setTrukLimits} />
          <label className="toggle">
            <input type="checkbox" checked={useSf} onChange={(e) => setUseSf(e.target.checked)} />
            <span>Comparer avec Stockfish</span>
          </label>
          {useSf && <SfLimitsEditor limits={sfLimits} onChange={setSfLimits} />}
          <div className="toolbar">
            <button className="btn primary" disabled={!sel || progress !== null} onClick={() => void run()}>
              Analyser
            </button>
            <button className="btn" disabled={progress === null} onClick={() => (abort.current = true)}>
              Arrêter
            </button>
            <button className="btn" disabled={!results.length} onClick={() => downloadText('dataset-resultats.csv', datasetResultsToCsv(results), 'text/csv')}>
              Export CSV
            </button>
            <button className="btn" disabled={!results.length} onClick={() => downloadText('dataset-resultats.json', JSON.stringify(results, null, 2))}>
              Export JSON
            </button>
          </div>
          {progress !== null && sel && (
            <div className="progress">
              <div style={{ width: `${(progress / sel.positions.length) * 100}%` }} />
              <span>
                {progress}/{sel.positions.length}
              </span>
            </div>
          )}
          {results.length > 0 && (
            <div className="stat-tiles">
              <div className="tile">
                <span>Erreur absolue moyenne (vs SF)</span>
                <b>{mae === null ? '—' : (mae / 100).toFixed(2)}</b>
              </div>
              <div className="tile">
                <span>Même meilleur coup</span>
                <b>{fmtPct(agree)}</b>
              </div>
              <div className="tile">
                <span>Tests résolus (bm/am)</span>
                <b>{solveRate === null ? '—' : `${fmtPct(solveRate)} (${tests.filter((r) => r.solved).length}/${tests.length})`}</b>
              </div>
              <div className="tile">
                <span>Nœuds moyens Truk</span>
                <b>{fmtInt(results.reduce((s, r) => s + r.trukNodes, 0) / results.length)}</b>
              </div>
            </div>
          )}
          <table className="table small clickable">
            <thead>
              <tr>
                <th>Id</th>
                <th className="num">Statique</th>
                <th className="num">Truk</th>
                <th>Coup</th>
                <th className="num">Prof.</th>
                <th className="num">Nœuds</th>
                <th className="num">ms</th>
                <th className="num">SF</th>
                <th>Coup SF</th>
                <th className="num">Δ</th>
                <th>=</th>
                <th>Test</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} onClick={() => setView(r.fen)}>
                  <td>{r.id ?? i + 1}</td>
                  <td className="num">{fmtCp(r.staticEval)}</td>
                  <td className="num">{fmtWhite(r.trukScore)}</td>
                  <td>{uciToSanSafe(r.fen, r.trukMove)}</td>
                  <td className="num">{r.trukDepth}</td>
                  <td className="num">{fmtInt(r.trukNodes)}</td>
                  <td className="num">{r.trukTimeMs.toFixed(0)}</td>
                  <td className="num">{fmtWhite(r.sfScore)}</td>
                  <td>{uciToSanSafe(r.fen, r.sfMove)}</td>
                  <td className="num">{r.delta !== null && Math.abs(r.delta) >= 5000 ? 'mat' : fmtCp(r.delta)}</td>
                  <td className={r.sameMove ? 'pos' : ''}>{r.sameMove === null ? '' : r.sameMove ? 'oui' : 'non'}</td>
                  <td className={r.solved === null ? '' : r.solved ? 'pos' : 'neg'}>{r.solved === null ? '' : r.solved ? 'résolu' : 'échec'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
