import { describe, expect, it } from 'vitest';
import { parseFen, toFen } from '../src/core/fen';
import { Game } from '../src/core/game';
import { START_FEN } from '../src/core/types';
import { entryValue, evaluate, evaluateDetailed } from '../src/engine/evaluate';
import { EVAL_TERMS, defaultEvalParams } from '../src/engine/params';

/** Miroir vertical + inversion des couleurs : l'évaluation doit changer de signe exactement. */
function mirrorFen(fen: string): string {
  const [pl, side, castle, ep, hm, fm] = fen.split(' ');
  const rows = pl.split('/').reverse().map((r) => r.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())));
  const c2 = castle === '-' ? '-' : castle.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).sort((a, b) => {
    const order = 'KQkq';
    return order.indexOf(a) - order.indexOf(b);
  }).join('');
  const ep2 = ep === '-' ? '-' : ep[0] + (9 - parseInt(ep[1], 10));
  return [rows.join('/'), side === 'w' ? 'b' : 'w', c2, ep2, hm, fm].join(' ');
}

const FENS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '8/5pk1/6p1/3P4/8/6PP/5K2/8 w - - 0 40',
  '2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 b - - 0 30',
  '4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1',
];

function randomPositions(n: number): string[] {
  let s = 7;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const out: string[] = [];
  while (out.length < n) {
    const g = new Game();
    const len = 10 + Math.floor(rand() * 80);
    for (let i = 0; i < len; i++) {
      const ms = g.pos.legalMoves();
      if (!ms.length) break;
      g.play(ms[Math.floor(rand() * ms.length)]);
    }
    out.push(g.fen);
  }
  return out;
}

describe('évaluation', () => {
  const params = defaultEvalParams();

  it('position initiale : symétrique (seul le trait compte)', () => {
    const d = evaluateDetailed(parseFen(START_FEN), params);
    for (const t of EVAL_TERMS) {
      if (t === 'tempo') continue;
      expect(d.terms[t].value, t).toBe(0);
    }
    expect(d.total).toBe(params.tempo.mg); // seul le trait compte (phase 24 = 100 % MG)
  });

  it('symétrie couleur : eval(miroir) = −eval', () => {
    for (const fen of [...FENS, ...randomPositions(150)]) {
      const a = evaluate(parseFen(fen), params);
      const b = evaluate(parseFen(mirrorFen(fen)), params);
      expect(b, fen).toBe(-a);
    }
  });

  it('la décomposition somme exactement au total (aucun terme caché)', () => {
    for (const fen of [...FENS, ...randomPositions(150)]) {
      const pos = parseFen(fen);
      const d = evaluateDetailed(pos, params);
      expect(d.total).toBe(evaluate(pos, params));
      const sumTerms = EVAL_TERMS.reduce((s, t) => s + d.terms[t].value, 0);
      expect(sumTerms).toBeCloseTo(d.exact, 6);
      // Somme des contributions élémentaires = somme des composantes.
      const sumEntries = d.entries.reduce((s, e) => s + (e.color === 0 ? 1 : -1) * entryValue(e, d.phase), 0);
      expect(sumEntries).toBeCloseTo(d.exact, 6);
    }
  });

  it('stabilité : évaluation déterministe et position non modifiée', () => {
    for (const fen of randomPositions(50)) {
      const pos = parseFen(fen);
      const a = evaluate(pos, params);
      const b = evaluate(pos, params);
      expect(a).toBe(b);
      expect(toFen(pos)).toBe(fen);
    }
  });

  it('désactiver une composante la met à zéro', () => {
    const p2 = defaultEvalParams();
    p2.enabled.mobility = false;
    const d = evaluateDetailed(parseFen(FENS[1]), p2);
    expect(d.terms.mobility.value).toBe(0);
    expect(d.entries.some((e) => e.term === 'mobility')).toBe(false);
  });

  it('matériel : pion de plus = +100 dans la composante matériel', () => {
    const d = evaluateDetailed(parseFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), params);
    expect(d.terms.material.value).toBe(100);
  });

  it('pion passé : avancement et bonus passé séparés et identifiables', () => {
    const d = evaluateDetailed(parseFen('4k3/8/4P3/8/8/8/8/4K3 w - - 0 1'), params);
    const adv = d.entries.find((e) => e.key === 'advance');
    const passed = d.entries.find((e) => e.key === 'passed');
    expect(adv?.mg).toBe(50); // rangée 6
    expect(passed?.eg).toBe(params.passedPawn.eg[5]);
  });

  it('pions doublés, isolés et arriérés détectés', () => {
    const d = evaluateDetailed(parseFen('4k3/8/8/8/8/2P5/2P5/4K3 w - - 0 1'), params);
    expect(d.entries.filter((e) => e.key === 'doubled').length).toBe(1);
    expect(d.entries.filter((e) => e.key === 'isolated').length).toBe(2);
    const d2 = evaluateDetailed(parseFen('4k3/8/8/2p5/1P6/2P5/8/4K3 w - - 0 1'), params);
    // c3 : voisin b4 plus avancé, case d'arrêt c4 contrôlée par… rien (c5 contrôle b4/d4) → pas arriéré.
    expect(d2.entries.filter((e) => e.key === 'backward' && e.color === 0).length).toBe(0);
    const d3 = evaluateDetailed(parseFen('4k3/8/8/1p6/8/2P5/1P6/4K3 w - - 0 1'), params);
    expect(d3.entries.filter((e) => e.key === 'connected' && e.color === 0).length).toBe(1);
  });

  it('les tables PST sont interpolées selon la phase', () => {
    const p2 = defaultEvalParams();
    const pos = parseFen('4k3/8/8/8/3K4/8/8/8 w - - 0 1'); // phase 0 : roi central en finale
    const d = evaluateDetailed(pos, p2);
    expect(d.phase).toBe(0);
    const kingEntry = d.entries.find((e) => e.key === 'pst' && e.sq === 0x33);
    expect(kingEntry?.eg).toBe(40);
  });
});
