import { useState } from 'react';
import { LabProvider } from './state';
import { usePersistent } from './usePersistent';
import { AnalysisView } from './views/AnalysisView';
import { DatasetView } from './views/DatasetView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { GameAnalysisView } from './views/GameAnalysisView';
import { HistoryView } from './views/HistoryView';
import { LabView } from './views/LabView';
import { LadderView } from './views/LadderView';
import { ParamsView } from './views/ParamsView';
import { PlayView } from './views/PlayView';
import { TournamentView } from './views/TournamentView';

const TABS = [
  { id: 'play', label: 'Jouer', hint: 'Modes A, B, C' },
  { id: 'analysis', label: 'Analyse', hint: 'Modes E, F' },
  { id: 'game', label: 'Comparer une partie', hint: 'Accord, CPL, gaffes' },
  { id: 'tournament', label: 'Tournoi', hint: 'Mode D' },
  { id: 'ladder', label: 'Échelle', hint: 'Budget en nœuds' },
  { id: 'lab', label: 'Lab A/B', hint: 'Deux configurations' },
  { id: 'dataset', label: 'Dataset', hint: 'Positions de test' },
  { id: 'params', label: 'Paramètres', hint: 'Évaluation & PST' },
  { id: 'history', label: 'Historique', hint: 'Résultats enregistrés' },
  { id: 'diag', label: 'Diagnostics', hint: 'Perft & vitesse' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = usePersistent<TabId>('lab.tab', () => 'play');
  // Les vues de calcul long restent montées pour ne pas interrompre un tournoi en changeant d'onglet.
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tab]));
  const go = (t: TabId) => {
    setVisited((v) => new Set(v).add(t));
    setTab(t);
  };
  const views: Record<TabId, React.ReactNode> = {
    play: <PlayView />,
    analysis: <AnalysisView />,
    game: <GameAnalysisView />,
    tournament: <TournamentView />,
    ladder: <LadderView />,
    lab: <LabView />,
    dataset: <DatasetView />,
    params: <ParamsView />,
    history: <HistoryView key={tab === 'history' ? 'h-on' : 'h-off'} />,
    diag: <DiagnosticsView />,
  };
  return (
    <LabProvider>
      <header className="topbar">
        <div className="brand">
          <span className="logo">♞</span> Chess-truk <span className="muted">Lab</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} title={t.hint}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {TABS.map((t) =>
          visited.has(t.id) || tab === t.id ? (
            <div key={t.id} style={{ display: tab === t.id ? 'block' : 'none' }}>
              {views[t.id]}
            </div>
          ) : null,
        )}
      </main>
    </LabProvider>
  );
}
