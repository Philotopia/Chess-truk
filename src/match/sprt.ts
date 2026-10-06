// SPRT (test séquentiel du rapport de vraisemblance), approximation trinomiale avec Elo logistique.
// H0 : Elo = elo0 ; H1 : Elo = elo1. On s'arrête dès que le LLR franchit une borne.

export interface SprtResult {
  llr: number;
  lower: number;
  upper: number;
  status: 'H0' | 'H1' | 'continue';
}

const scoreOf = (elo: number) => 1 / (1 + Math.pow(10, -elo / 400));

export function sprt(w: number, d: number, l: number, elo0: number, elo1: number, alpha = 0.05, beta = 0.05): SprtResult {
  const lower = Math.log(beta / (1 - alpha));
  const upper = Math.log((1 - beta) / alpha);
  const n = w + d + l;
  let llr = 0;
  if (n > 0) {
    const x = (w + d / 2) / n;
    const v = (w * (1 - x) ** 2 + d * (0.5 - x) ** 2 + l * x * x) / n;
    if (v > 0) {
      const s0 = scoreOf(elo0);
      const s1 = scoreOf(elo1);
      llr = (n * (s1 - s0) * (2 * x - s0 - s1)) / (2 * v);
    }
  }
  return { llr, lower, upper, status: llr >= upper ? 'H1' : llr <= lower ? 'H0' : 'continue' };
}
