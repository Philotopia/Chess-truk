// Page « Jouer contre Truk » : échiquier, moteur Truk V2 dans un Web Worker, explication de l'évaluation.
import { parseFen } from '../src/core/fen';
import { Game, REASON_FR } from '../src/core/game';
import { moveToUci } from '../src/core/notation';
import { exportPgn } from '../src/core/pgn';
import { PIECE_CHARS, START_FEN, makeSq, sqName } from '../src/core/types';
import { TrukEngine } from '../src/engine/engine';
import { evaluateDetailed } from '../src/engine/evaluate';
import { EVAL_TERMS, EVAL_TERM_LABELS, defaultEngineConfig } from '../src/engine/params';
import type { SearchLimits, SearchResult } from '../src/engine/search';

type Level = 'debutant' | 'club' | 'fort' | 'max';
const LEVELS: Record<Level, { label: string; hint: string; limits: SearchLimits }> = {
  debutant: { label: 'Débutant', hint: '1 coup d’avance', limits: { depth: 1 } },
  club: { label: 'Club', hint: '3 coups d’avance', limits: { depth: 3 } },
  fort: { label: 'Fort', hint: '1 seconde par coup', limits: { timeMs: 1000 } },
  max: { label: 'Maximum', hint: '3 secondes par coup', limits: { timeMs: 3000 } },
};
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const params = defaultEngineConfig().eval;

interface Saved {
  moves: string[];
  human: 0 | 1;
  level: Level;
  flipped: boolean;
  showEval: boolean;
}

// --- État ---
let game = new Game(START_FEN);
let human: 0 | 1 = 0;
let level: Level = 'club';
let flipped = false;
let showEval = false;
let selected: string | null = null;
let thinking = false;
let lastSearch: { result: SearchResult; whiteToMove: boolean } | null = null;
let promo: { from: string; to: string } | null = null;
let token = 0;
let resigned = false;

// --- Moteur (Web Worker, repli sur le fil principal si indisponible) ---
let worker: Worker | null = null;
let fallback: TrukEngine | null = null;
const pending = new Map<number, (r: SearchResult | null) => void>();
let nextId = 1;
function startWorker() {
  try {
    const src = document.getElementById('truk-worker')?.textContent ?? '';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e) => {
      const { id, ok, result } = e.data;
      pending.get(id)?.(ok ? result : null);
      pending.delete(id);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [, cb] of pending) cb(null);
      pending.clear();
    };
  } catch {
    worker = null;
  }
}
function search(moves: string[], limits: SearchLimits, newGame: boolean): Promise<SearchResult | null> {
  if (worker) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker!.postMessage({ id, startFen: START_FEN, moves, limits, newGame });
    });
  }
  return new Promise((resolve) =>
    setTimeout(() => {
      fallback ??= new TrukEngine(defaultEngineConfig());
      if (newGame) fallback.newGame();
      try {
        resolve(fallback.searchGame(START_FEN, moves, limits));
      } catch {
        resolve(null);
      }
    }, 30),
  );
}

// --- Persistance ---
function save() {
  const s: Saved = { moves: game.uciMoves(), human, level, flipped, showEval };
  try {
    localStorage.setItem('truk.play', JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}
function load(s: Saved | null) {
  if (!s) return;
  try {
    const g = new Game(START_FEN);
    for (const u of s.moves) g.playUci(u);
    game = g;
    human = s.human === 1 ? 1 : 0;
    level = s.level in LEVELS ? s.level : 'club';
    flipped = !!s.flipped;
    showEval = !!s.showEval;
  } catch {
    game = new Game(START_FEN);
  }
}

// --- Logique de partie ---
const $ = (id: string) => document.getElementById(id)!;

function status() {
  return game.status();
}
function humanToMove() {
  return game.pos.side === human && !status().over && !resigned;
}

async function engineTurn(newGame = false) {
  if (status().over || resigned || game.pos.side === human) return;
  thinking = true;
  const my = ++token;
  render();
  const t0 = performance.now();
  const r = await search(game.uciMoves(), LEVELS[level].limits, newGame);
  // Un minimum de 350 ms rend le coup lisible.
  const wait = 350 - (performance.now() - t0);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  if (my !== token) return;
  thinking = false;
  if (r?.bestMove) {
    const wtm = game.pos.side === 0;
    game.playUci(r.bestMove);
    lastSearch = { result: r, whiteToMove: wtm };
  }
  save();
  render();
}

function playHuman(uci: string) {
  if (!humanToMove()) return;
  try {
    game.playUci(uci);
  } catch {
    return;
  }
  selected = null;
  save();
  render();
  void engineTurn();
}

function newGame(color: 0 | 1 | 'random') {
  token++;
  thinking = false;
  resigned = false;
  game = new Game(START_FEN);
  human = color === 'random' ? (Math.random() < 0.5 ? 0 : 1) : color;
  flipped = human === 1;
  lastSearch = null;
  selected = null;
  promo = null;
  save();
  render();
  void engineTurn(true);
}

function undo() {
  if (thinking) {
    token++;
    thinking = false;
  }
  resigned = false;
  // Revenir au dernier coup du joueur humain.
  if (game.moves.length && game.pos.side !== human) game.undo();
  else if (game.moves.length >= 2) {
    game.undo();
    game.undo();
  }
  selected = null;
  lastSearch = null;
  save();
  render();
  void engineTurn();
}

// --- Rendu ---
function legalFrom(sq: string): string[] {
  return game.pos.legalMoves().map(moveToUci).filter((u) => u.startsWith(sq));
}

function boardHtml(): string {
  const pos = game.pos;
  const last = game.moves.length ? game.moves[game.moves.length - 1].uci : null;
  const checkSq = pos.inCheck() ? sqName(pos.kingSq[pos.side]) : null;
  const targets = selected ? new Set(legalFrom(selected).map((u) => u.slice(2, 4))) : new Set<string>();
  let h = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const rank = flipped ? i : 7 - i;
      const file = flipped ? 7 - j : j;
      const sq = sqName(makeSq(file, rank));
      const p = pos.board[makeSq(file, rank)];
      const cls = ['sq', (rank + file) % 2 ? 'light' : 'dark'];
      if (last && (last.slice(0, 2) === sq || last.slice(2, 4) === sq)) cls.push('last');
      if (selected === sq) cls.push('sel');
      if (checkSq === sq) cls.push('check');
      let inner = '';
      if (p) {
        const ch = PIECE_CHARS[p];
        const white = ch === ch.toUpperCase();
        inner += `<span class="pc ${white ? 'w' : 'b'}">${GLYPH[ch.toLowerCase()]}︎</span>`;
      }
      if (targets.has(sq)) inner += `<span class="dot${p ? ' cap' : ''}"></span>`;
      if (j === 0) inner += `<span class="co r">${rank + 1}</span>`;
      if (i === 7) inner += `<span class="co f">${'abcdefgh'[file]}</span>`;
      h += `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}">${inner}</button>`;
    }
  }
  return h;
}

function fmtScore(cpWhite: number | null, mateWhite: number | null): string {
  if (mateWhite !== null) return mateWhite > 0 ? `mat en ${mateWhite} pour les Blancs` : `mat en ${-mateWhite} pour les Noirs`;
  if (cpWhite === null) return '—';
  return (cpWhite >= 0 ? '+' : '') + (cpWhite / 100).toFixed(2);
}

function render() {
  $('board').innerHTML = boardHtml();
  const st = status();
  let line: string;
  if (resigned) line = 'Vous avez abandonné. Truk gagne.';
  else if (st.over) {
    const youWin = (st.result === '1-0' && human === 0) || (st.result === '0-1' && human === 1);
    line =
      st.result === '1/2-1/2'
        ? `Partie nulle (${REASON_FR[st.reason]}).`
        : youWin
          ? `Vous gagnez (${REASON_FR[st.reason]}) !`
          : `Truk gagne (${REASON_FR[st.reason]}).`;
  } else if (thinking) line = 'Truk réfléchit…';
  else line = `À vous de jouer${st.inCheck ? ' — vous êtes en échec' : ''}.`;
  $('status').textContent = line;
  $('status').className = 'status' + (thinking ? ' busy' : '') + (st.over || resigned ? ' over' : '');
  $('you').textContent = human === 0 ? 'Blancs' : 'Noirs';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === level));
  $('level-hint').textContent = LEVELS[level].hint;
  // Coups.
  const parts: string[] = [];
  game.moves.forEach((m, i) => {
    if (i % 2 === 0) parts.push(`<span class="n">${i / 2 + 1}.</span>`);
    parts.push(`<span class="mv${i === game.moves.length - 1 ? ' cur' : ''}">${m.san}</span>`);
  });
  $('moves').innerHTML = parts.join(' ') || '<span class="muted">La partie n’a pas commencé.</span>';
  $('moves').scrollTop = $('moves').scrollHeight;
  // Évaluation de Truk.
  const evalBox = $('eval');
  evalBox.hidden = !showEval;
  ($('toggle-eval') as HTMLButtonElement).textContent = showEval ? 'Masquer l’avis de Truk' : 'Voir l’avis de Truk';
  if (showEval) renderEval();
  ($('undo') as HTMLButtonElement).disabled = game.moves.length === 0;
  ($('resign') as HTMLButtonElement).disabled = st.over || resigned || game.moves.length < 2;
  // Promotion.
  $('promo').hidden = !promo;
  if (promo) {
    $('promo-choices').innerHTML = ['q', 'r', 'b', 'n']
      .map((p) => `<button class="pc ${human === 0 ? 'w' : 'b'}" data-promo="${p}" aria-label="${p}">${GLYPH[p]}︎</button>`)
      .join('');
  }
}

function renderEval() {
  // Score de recherche de Truk (dernier coup) + décomposition statique de la position actuelle.
  let searchLine = 'Truk n’a pas encore joué.';
  let bar = 50;
  if (lastSearch) {
    const r = lastSearch.result;
    const sign = lastSearch.whiteToMove ? 1 : -1;
    const cp = r.mate === null ? r.score * sign : null;
    const mate = r.mate === null ? null : r.mate * sign;
    searchLine = `Après réflexion (profondeur ${r.completedDepth}, ${r.nodes.toLocaleString('fr-FR')} positions) : ${fmtScore(cp, mate)}`;
    bar = mate !== null ? (mate > 0 ? 100 : 0) : 100 / (1 + Math.pow(10, -(cp ?? 0) / 400));
  }
  $('eval-search').textContent = searchLine;
  ($('eval-fill') as HTMLElement).style.width = `${bar.toFixed(1)}%`;
  const d = evaluateDetailed(parseFen(game.fen), params);
  const yours = human === 0 ? 1 : -1;
  const rows = EVAL_TERMS.map((t) => ({ t, v: d.terms[t].value * yours }))
    .filter((x) => Math.abs(x.v) >= 3)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 6);
  $('eval-static').innerHTML =
    rows
      .map(
        (x) =>
          `<li><span>${EVAL_TERM_LABELS[x.t]}</span><b class="${x.v > 0 ? 'good' : 'bad'}">${x.v > 0 ? '+' : ''}${(x.v / 100).toFixed(2)}</b><small>${x.v > 0 ? 'pour vous' : 'pour Truk'}</small></li>`,
      )
      .join('') || '<li class="muted">Position équilibrée selon chaque critère.</li>';
  const tot = d.exact * yours;
  $('eval-total').textContent = `${tot >= 0 ? '+' : ''}${(tot / 100).toFixed(2)} ${tot >= 0 ? 'pour vous' : 'pour Truk'}`;
}

// --- Interactions ---
function onSquare(sq: string) {
  if (!humanToMove() || promo) return;
  const p = game.pos.board[makeSq(sq.charCodeAt(0) - 97, Number(sq[1]) - 1)];
  const own = p !== 0 && (p >> 3) === human;
  if (selected) {
    const cands = legalFrom(selected).filter((u) => u.slice(2, 4) === sq);
    if (cands.length > 1) {
      promo = { from: selected, to: sq };
      render();
      return;
    }
    if (cands.length === 1) {
      playHuman(cands[0]);
      return;
    }
  }
  selected = own && selected !== sq ? sq : null;
  render();
}

function wire() {
  $('board').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sq]');
    if (b) onSquare(b.dataset.sq!);
  });
  $('promo').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-promo]');
    if (b && promo) {
      const u = promo.from + promo.to + b.dataset.promo;
      promo = null;
      playHuman(u);
    } else if ((e.target as HTMLElement).id === 'promo-cancel') {
      promo = null;
      selected = null;
      render();
    }
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-new]')) {
    b.addEventListener('click', () => newGame(b.dataset.new === 'w' ? 0 : b.dataset.new === 'b' ? 1 : 'random'));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-level]')) {
    b.addEventListener('click', () => {
      level = b.dataset.level as Level;
      save();
      render();
    });
  }
  $('undo').addEventListener('click', undo);
  $('flip').addEventListener('click', () => {
    flipped = !flipped;
    save();
    render();
  });
  $('toggle-eval').addEventListener('click', () => {
    showEval = !showEval;
    save();
    render();
  });
  $('resign').addEventListener('click', () => {
    if ($('resign').dataset.confirm === '1') {
      resigned = true;
      token++;
      thinking = false;
      $('resign').dataset.confirm = '';
      $('resign').textContent = 'Abandonner';
      render();
    } else {
      $('resign').dataset.confirm = '1';
      $('resign').textContent = 'Confirmer l’abandon';
      setTimeout(() => {
        $('resign').dataset.confirm = '';
        $('resign').textContent = 'Abandonner';
      }, 3000);
    }
  });
  $('copy-pgn').addEventListener('click', async () => {
    const st = status();
    const pgn = exportPgn(
      game,
      { Event: 'Partie contre Truk', White: human === 0 ? 'Vous' : 'Truk V2', Black: human === 1 ? 'Vous' : 'Truk V2' },
      resigned ? (human === 0 ? '0-1' : '1-0') : st.over ? st.result : '*',
    );
    const out = $('pgn-out') as HTMLTextAreaElement;
    out.value = pgn;
    out.hidden = false;
    try {
      await navigator.clipboard.writeText(pgn);
      $('copy-pgn').textContent = 'PGN copié';
    } catch {
      out.select();
      $('copy-pgn').textContent = 'PGN sélectionné';
    }
    setTimeout(() => ($('copy-pgn').textContent = 'Copier le PGN'), 2000);
  });
}

// --- Démarrage ---
type Hot = { snapshot?: (f: () => unknown) => void; ready?: (f: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
function start(data: unknown) {
  let saved: Saved | null = (data as Saved) ?? null;
  if (!saved || !Array.isArray(saved.moves)) {
    try {
      saved = JSON.parse(localStorage.getItem('truk.play') ?? 'null');
    } catch {
      saved = null;
    }
  }
  load(saved);
  startWorker();
  wire();
  render();
  void engineTurn(true);
}
hot?.snapshot?.(() => ({ moves: game.uciMoves(), human, level, flipped, showEval }));
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? null);
