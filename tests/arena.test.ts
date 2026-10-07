import { describe, expect, it } from 'vitest';
import { eloWithSe, estimateOptimum, fitParabola } from '../src/match/arena';

describe('arène des valeurs de pièces', () => {
  it('Elo et écart-type cohérents avec le score', () => {
    const { elo, se } = eloWithSe(60, 80, 60);
    expect(elo).toBeCloseTo(0, 6);
    expect(se).toBeGreaterThan(10);
    expect(se).toBeLessThan(40);
    expect(eloWithSe(120, 40, 40).elo).toBeGreaterThan(100);
  });

  it('retrouve le sommet d’une parabole exacte', () => {
    // Elo(d) = −0,01·(d − 20)² + 4 → passe par 0 en d = 0, optimum en d = +20.
    const pts = [-60, -30, 30, 60].map((d) => ({ offset: d, elo: -0.01 * (d - 20) ** 2 + 4, se: 10 }));
    const f = fitParabola(pts);
    expect(f.optimum).toBeCloseTo(20, 6);
    expect(f.gainAtOptimum).toBeCloseTo(4, 6);
  });

  it('bootstrap : intervalle contenant l’optimum, et courbe monotone signalée', () => {
    const pts = [-60, -30, 30, 60].map((d) => ({ offset: d, elo: -0.01 * (d - 20) ** 2 + 4, se: 8, games: 200, wins: 0, draws: 0, losses: 0 }));
    const e = estimateOptimum(pts, 2000);
    expect(e.low!).toBeLessThan(20);
    expect(e.high!).toBeGreaterThan(20);
    const mono = [-60, -30, 30, 60].map((d) => ({ offset: d, elo: d, se: 5, games: 200, wins: 0, draws: 0, losses: 0 }));
    const m = estimateOptimum(mono, 500);
    expect(m.optimum).toBeNull();
    expect(m.concaveShare).toBeLessThan(0.5);
  });
});
