// Livre d'ouvertures équilibrées (coups SAN). Chaque ouverture est jouée deux fois, couleurs inversées,
// ce qui neutralise l'avantage du trait et évite des parties identiques avec des moteurs déterministes.
import { Game } from '../core/game';
import { START_FEN } from '../core/types';

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

/** Ouvertures pour n parties (une ouverture par paire de parties). */
export function openingForGame(gameIndex: number, mode: 'book' | 'startpos', seedOffset = 0): Opening {
  if (mode === 'startpos') return { name: 'Position initiale', moves: [] };
  const pair = Math.floor(gameIndex / 2);
  return OPENING_BOOK[(pair + seedOffset) % OPENING_BOOK.length];
}

/** Convertit une ouverture en coups UCI depuis la position initiale. */
export function openingToUci(o: Opening, startFen = START_FEN): string[] {
  const g = new Game(startFen);
  for (const s of o.moves) g.playSan(s);
  return g.uciMoves();
}
