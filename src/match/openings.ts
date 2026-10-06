// Livre d'ouvertures équilibrées (coups SAN). Chaque ouverture est jouée deux fois, couleurs inversées,
// ce qui neutralise l'avantage du trait et évite des parties identiques avec des moteurs déterministes.
import { Game } from '../core/game';
import { START_FEN } from '../core/types';
import { defaultEvalParams, defaultSearchOptions } from '../engine/params';
import { Searcher } from '../engine/search';
import OPENING_SUITE_RAW from './openingSuite.json';

const OPENING_SUITE = OPENING_SUITE_RAW as Opening[];

export interface Opening {
  name: string;
  moves: string[];
}

const L = (name: string, line: string): Opening => ({ name, moves: line.split(' ') });

export const OPENING_BOOK: Opening[] = [
  L('Espagnole', 'e4 e5 Nf3 Nc6 Bb5 a6'),
  L('Italienne', 'e4 e5 Nf3 Nc6 Bc4 Bc5'),
  L('Écossaise', 'e4 e5 Nf3 Nc6 d4 exd4'),
  L('Petrov', 'e4 e5 Nf3 Nf6 Nxe5 d6'),
  L('Quatre cavaliers', 'e4 e5 Nf3 Nc6 Nc3 Nf6'),
  L('Viennoise', 'e4 e5 Nc3 Nf6 f4 d5'),
  L('Philidor', 'e4 e5 Nf3 d6 d4 Nf6'),
  L('Sicilienne ouverte', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6'),
  L('Sicilienne dragon accéléré', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6'),
  L('Sicilienne Kan', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6'),
  L('Sicilienne fermée', 'e4 c5 Nc3 Nc6 g3 g6'),
  L('Sicilienne Alapin', 'e4 c5 c3 Nf6 e5 Nd5'),
  L('Sicilienne Moscou', 'e4 c5 Nf3 d6 Bb5+ Bd7'),
  L('Française Winawer', 'e4 e6 d4 d5 Nc3 Bb4'),
  L('Française avance', 'e4 e6 d4 d5 e5 c5'),
  L('Caro-Kann classique', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'),
  L('Caro-Kann avance', 'e4 c6 d4 d5 e5 Bf5'),
  L('Scandinave', 'e4 d5 exd5 Qxd5 Nc3 Qa5'),
  L('Pirc', 'e4 d6 d4 Nf6 Nc3 g6'),
  L('Moderne', 'e4 g6 d4 Bg7 Nc3 d6'),
  L('Alekhine', 'e4 Nf6 e5 Nd5 d4 d6'),
  L('Gambit dame refusé', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7'),
  L('Slave', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4'),
  L('Gambit dame accepté', 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6'),
  L('Catalane', 'd4 Nf6 c4 e6 g3 d5'),
  L('Est-indienne', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6'),
  L('Nimzo-indienne', 'd4 Nf6 c4 e6 Nc3 Bb4'),
  L('Ouest-indienne', 'd4 Nf6 c4 e6 Nf3 b6'),
  L('Grünfeld', 'd4 Nf6 c4 g6 Nc3 d5'),
  L('Benoni', 'd4 Nf6 c4 c5 d5 e6'),
  L('Hollandaise', 'd4 f5 g3 Nf6 Bg2 e6'),
  L('Système de Londres', 'd4 d5 Nf3 Nf6 Bf4 e6'),
  L('Torre', 'd4 Nf6 Nf3 e6 Bg5 c5'),
  L('Anglaise quatre cavaliers', 'c4 e5 Nc3 Nf6 Nf3 Nc6'),
  L('Anglaise symétrique', 'c4 c5 Nc3 Nc6 g3 g6'),
  L('Anglaise / GD', 'c4 e6 Nc3 d5 d4 Nf6'),
  L('Réti', 'Nf3 d5 g3 Nf6 Bg2 c6'),
  L('Réti ouest-indienne', 'Nf3 Nf6 c4 b6 g3 Bb7'),
  L('Larsen', 'b3 e5 Bb2 Nc6 e3 d5'),
  L('Catalane fermée', 'd4 d5 c4 e6 Nf3 Nf6 g3 Be7'),
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomCache = new Map<string, Opening>();
let balanceSearcher: Searcher | null = null;

/**
 * Ouverture du livre prolongée de 2 à 4 demi-coups aléatoires (graine déterministe), retenue seulement si une
 * recherche courte de Truk la juge équilibrée (|score| < 100 cp). Permet des milliers de parties distinctes.
 */
export function randomOpening(pair: number, seed: number): Opening {
  const key = `${seed}:${pair}`;
  const cached = randomCache.get(key);
  if (cached) return cached;
  const rand = mulberry32(seed * 1000003 + pair * 7919 + 17);
  const base = OPENING_BOOK[pair % OPENING_BOOK.length];
  if (!balanceSearcher) {
    balanceSearcher = new Searcher(defaultEvalParams(), { ...defaultSearchOptions(), ttSizeMB: 1 });
  }
  let result: Opening = base;
  for (let attempt = 0; attempt < 30; attempt++) {
    const g = new Game(START_FEN);
    for (const s of base.moves) g.playSan(s);
    const extra = 2 + Math.floor(rand() * 3);
    let ok = true;
    for (let k = 0; k < extra; k++) {
      const ms = g.pos.legalMoves();
      if (!ms.length) {
        ok = false;
        break;
      }
      g.play(ms[Math.floor(rand() * ms.length)]);
    }
    if (!ok || g.status().over) continue;
    balanceSearcher.newGame();
    const r = balanceSearcher.search(g.pos, { depth: 4 });
    if (r.mate === null && Math.abs(r.score) < 100) {
      result = { name: `${base.name} +${extra}`, moves: g.moves.map((m) => m.san) };
      break;
    }
  }
  randomCache.set(key, result);
  return result;
}

/** Ouvertures pour n parties (une ouverture par paire de parties, couleurs inversées). */
export function openingForGame(gameIndex: number, mode: 'book' | 'startpos' | 'random', seedOffset = 0, seed = 1): Opening {
  if (mode === 'startpos') return { name: 'Position initiale', moves: [] };
  const pair = Math.floor(gameIndex / 2);
  if (mode === 'random') {
    // Suite figée (identique pour toutes les versions du moteur) ; génération à la volée au-delà.
    const idx = pair + seedOffset + (seed - 1) * 7919;
    return idx < OPENING_SUITE.length ? OPENING_SUITE[idx % OPENING_SUITE.length] : randomOpening(idx, seed);
  }
  return OPENING_BOOK[(pair + seedOffset) % OPENING_BOOK.length];
}

/** Convertit une ouverture en coups UCI depuis la position initiale. */
export function openingToUci(o: Opening, startFen = START_FEN): string[] {
  const g = new Game(startFen);
  for (const s of o.moves) g.playSan(s);
  return g.uciMoves();
}
