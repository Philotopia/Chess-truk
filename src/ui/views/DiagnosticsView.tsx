import { useState } from 'react';
import { multiThreadAvailable } from '../../stockfish/browserTransport';
import { fmtInt } from '../format';
import { sfInfo } from '../services';
import { useLab } from '../state';

interface PerftRow {
  name: string;
  depth: number;
  expected: number;
  got: number;
  ms: number;
}
interface BenchRow {
  fen: string;
  depth: number;
  nodes: number;
  ms: number;
  nps: number;
  best: string;
}

/** Diagnostics : perft dans le navigateur, banc de vitesse, environnement Stockfish. */
export function DiagnosticsView() {
  const lab = useLab();
  const [perft, setPerft] = useState<PerftRow[]>([]);
  const [bench, setBench] = useState<BenchRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sf, setSf] = useState<{ name: string; options: { name: string; type: string; default?: string; min?: number; max?: number }[] } | null>(null);
  const [sfErr, setSfErr] = useState<string | null>(null);

  const runWorker = (type: 'perft' | 'bench') => {
    setBusy(type);
    if (type === 'perft') setPerft([]);
    else setBench([]);
    const w = new Worker(new URL('../../workers/diag.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'perft') setPerft((p) => [...p, d]);
      else if (d.type === 'bench') setBench((b) => [...b, d]);
      else if (d.type === 'done') {
        setBusy(null);
        w.terminate();
      }
    };
    w.postMessage({ type, depth: 6 });
  };

  const allOk = perft.length > 0 && perft.every((r) => r.got === r.expected);
  const totNodes = bench.reduce((s, b) => s + b.nodes, 0);
  const totMs = bench.reduce((s, b) => s + b.ms, 0);

  return (
    <div className="layout2">
      <section className="col-board">
        <div className="panel">
          <h3>Perft (générateur de coups)</h3>
          <p className="muted small">
            Compte les positions légales à profondeur fixe et compare aux valeurs de référence publiées (chessprogramming.org). Le moteur ne
            doit pas être évalué sérieusement tant qu’une ligne échoue.
          </p>
          <button className="btn primary" disabled={!!busy} onClick={() => runWorker('perft')}>
            Lancer perft
          </button>
          {perft.length > 0 && (
            <div className={`conclusion ${allOk ? 'pos' : 'neg'}`}>
              {allOk ? `${perft.length} tests perft réussis.` : `${perft.filter((r) => r.got !== r.expected).length} échec(s).`}
              {busy === 'perft' && ' (en cours…)'}
            </div>
          )}
          <table className="table small">
            <thead>
              <tr>
                <th>Position</th>
                <th className="num">Prof.</th>
                <th className="num">Attendu</th>
                <th className="num">Obtenu</th>
                <th className="num">ms</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {perft.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td className="num">{r.depth}</td>
                  <td className="num">{fmtInt(r.expected)}</td>
                  <td className="num">{fmtInt(r.got)}</td>
                  <td className="num">{r.ms.toFixed(0)}</td>
                  <td className={r.got === r.expected ? 'pos' : 'neg'}>{r.got === r.expected ? 'OK' : 'ÉCHEC'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="col-main">
        <div className="panel">
          <h3>Banc de vitesse (recherche, 1,5 s par position)</h3>
          <button className="btn primary" disabled={!!busy} onClick={() => runWorker('bench')}>
            Lancer le banc
          </button>
          <table className="table small">
            <thead>
              <tr>
                <th>FEN</th>
                <th className="num">Prof.</th>
                <th className="num">Nœuds</th>
                <th className="num">ms</th>
                <th className="num">NPS</th>
                <th>Coup</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((b, i) => (
                <tr key={i}>
                  <td className="mono small">{b.fen.split(' ')[0].slice(0, 28)}…</td>
                  <td className="num">{b.depth}</td>
                  <td className="num">{fmtInt(b.nodes)}</td>
                  <td className="num">{b.ms.toFixed(0)}</td>
                  <td className="num">{fmtInt(b.nps)}</td>
                  <td>{b.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bench.length > 0 && !busy && (
            <div className="conclusion">
              Total : {fmtInt(totNodes)} nœuds en {totMs.toFixed(0)} ms → {fmtInt((totNodes * 1000) / Math.max(1, totMs))} nœuds/s
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Environnement</h3>
          <ul className="small">
            <li>Cross-origin isolated : {String((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false)}</li>
            <li>Stockfish multi-thread disponible : {multiThreadAvailable() ? 'oui' : 'non'}</li>
            <li>Cœurs logiques : {navigator.hardwareConcurrency ?? '?'}</li>
          </ul>
          <button
            className="btn"
            onClick={() =>
              sfInfo(lab.sfSettings)
                .then(setSf)
                .catch((e) => setSfErr((e as Error).message))
            }
          >
            Interroger Stockfish (UCI)
          </button>
          {sfErr && <div className="error">{sfErr}</div>}
          {sf && (
            <>
              <div className="strong">{sf.name}</div>
              <table className="table small">
                <tbody>
                  {sf.options.map((o) => (
                    <tr key={o.name}>
                      <td>{o.name}</td>
                      <td>{o.type}</td>
                      <td>{o.default}</td>
                      <td>{o.min !== undefined ? `${o.min} … ${o.max}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
