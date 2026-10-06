import { REASON_FR } from '../../core/game';
import { scoreForA } from '../../match/stats';
import { type TournamentRecord, tournamentPgn } from '../../match/tournament';
import { downloadText } from '../../storage/db';
import { fmtElo, fmtInt, fmtMs, fmtPct, fmtScore } from '../format';
import type { LiveState } from '../useTournament';
import { Board } from './Board';

export function LiveGame({ live }: { live: LiveState }) {
  const info = live.info;
  return (
    <div className="panel live">
      <h3>
        Partie {live.gameIndex + 1} en cours — {live.opening}
      </h3>
      <div className="muted small">
        {live.white} (blancs) – {live.black} (noirs) · {live.plies} demi-coups
      </div>
      {live.fen && <Board fen={live.fen} lastMove={live.lastMove} />}
      {info && (
        <div className="mono small">
          {live.whiteToMove ? 'Blancs' : 'Noirs'} : prof. {info.depth} · {fmtInt(info.nodes)} nœuds ·{' '}
          {fmtScore(
            info.scoreCp === null ? null : live.whiteToMove ? info.scoreCp : -info.scoreCp,
            info.mate === null ? null : live.whiteToMove ? info.mate : -info.mate,
          )}
        </div>
      )}
    </div>
  );
}

export function StatsTiles({ rec }: { rec: TournamentRecord }) {
  const s = rec.stats;
  const refElo = rec.config.b.kind === 'stockfish' ? rec.config.b.refElo : undefined;
  return (
    <>
      <div className="stat-tiles">
        <div className="tile">
          <span>Victoires / Nulles / Défaites (A)</span>
          <b>
            <span className="pos">{s.wins}</span> / {s.draws} / <span className="neg">{s.losses}</span>
          </b>
        </div>
        <div className="tile">
          <span>Score de A</span>
          <b>{fmtPct(s.score)}</b>
          <small>
            IC95 {fmtPct(s.scoreLow)} – {fmtPct(s.scoreHigh)}
          </small>
        </div>
        <div className="tile">
          <span>Elo A − B</span>
          <b>{s.elo !== null ? fmtElo(s.elo) : s.games === 0 ? 'n/d' : s.score === 0 ? `< ${fmtElo(s.eloHigh)}` : `> ${fmtElo(s.eloLow)}`}</b>
          <small>
            IC95 [{fmtElo(s.eloLow)} ; {fmtElo(s.eloHigh)}]
          </small>
        </div>
        <div className="tile">
          <span>LOS (A &gt; B)</span>
          <b>{s.los === null ? 'n/d' : fmtPct(s.los)}</b>
        </div>
        {refElo !== undefined && s.elo !== null && (
          <div className="tile">
            <span>Performance estimée de A</span>
            <b>{Math.round(refElo + s.elo)}</b>
            <small>réf. UCI_Elo {refElo} (indicatif)</small>
          </div>
        )}
      </div>
      <table className="table small">
        <tbody>
          <tr>
            <td>Parties jouées</td>
            <td className="num">
              {s.games} / {rec.config.games}
            </td>
            <td>Durée moyenne</td>
            <td className="num">{fmtMs(s.avgDurationMs)}</td>
          </tr>
          <tr>
            <td>Demi-coups moyens</td>
            <td className="num">{s.avgPlies.toFixed(1)}</td>
            <td>A avec les blancs (V/N/D)</td>
            <td className="num">
              {s.asWhite.w}/{s.asWhite.d}/{s.asWhite.l}
            </td>
          </tr>
          <tr>
            <td>Nœuds moyens / coup : A</td>
            <td className="num">{fmtInt(s.a.avgNodes)}</td>
            <td>B</td>
            <td className="num">{fmtInt(s.b.avgNodes)}</td>
          </tr>
          <tr>
            <td>Profondeur moyenne : A</td>
            <td className="num">{s.a.avgDepth.toFixed(1)}</td>
            <td>B</td>
            <td className="num">{s.b.avgDepth.toFixed(1)}</td>
          </tr>
          <tr>
            <td>Temps moyen / coup : A</td>
            <td className="num">{fmtMs(s.a.avgTimeMs)}</td>
            <td>B</td>
            <td className="num">{fmtMs(s.b.avgTimeMs)}</td>
          </tr>
          <tr>
            <td>A avec les noirs (V/N/D)</td>
            <td className="num">
              {s.asBlack.w}/{s.asBlack.d}/{s.asBlack.l}
            </td>
            <td>Fins de partie</td>
            <td>
              {Object.entries(s.reasons)
                .map(([k, v]) => `${REASON_FR[k as keyof typeof REASON_FR] ?? k} : ${v}`)
                .join(', ')}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

export function GamesTable({ rec }: { rec: TournamentRecord }) {
  return (
    <>
      <div className="toolbar">
        <button className="btn small" onClick={() => downloadText(`tournoi-${rec.id}.pgn`, tournamentPgn(rec), 'application/x-chess-pgn')}>
          Télécharger tous les PGN
        </button>
        <button className="btn small" onClick={() => downloadText(`tournoi-${rec.id}.json`, JSON.stringify(rec, null, 2))}>
          Exporter JSON (config + résultats)
        </button>
      </div>
      <table className="table small">
        <thead>
          <tr>
            <th>#</th>
            <th>Blancs</th>
            <th>Noirs</th>
            <th>Ouverture</th>
            <th>Résultat</th>
            <th>Score A</th>
            <th>Fin</th>
            <th className="num">½-coups</th>
            <th className="num">Durée</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rec.games.map((g) => (
            <tr key={g.index}>
              <td>{g.index + 1}</td>
              <td>{g.white}</td>
              <td>{g.black}</td>
              <td>{g.openingName}</td>
              <td className="strong">{g.result}</td>
              <td>{scoreForA(g)}</td>
              <td title={g.errorMessage}>{REASON_FR[g.reason]}</td>
              <td className="num">{g.moves.length}</td>
              <td className="num">{fmtMs(g.durationMs)}</td>
              <td>
                <button className="link" onClick={() => downloadText(`partie-${rec.id}-${g.index + 1}.pgn`, g.pgn, 'application/x-chess-pgn')}>
                  PGN
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
