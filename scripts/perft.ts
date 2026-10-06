// Perft complet (toutes les profondeurs de référence, y compris > 5 M de nœuds).
// Usage : npm run perft
import { parseFen } from '../src/core/fen';
import { PERFT_SUITE, perft } from '../src/core/perft';

let failures = 0;
for (const { name, fen, counts } of PERFT_SUITE) {
  counts.forEach((expected, i) => {
    const pos = parseFen(fen);
    const t0 = performance.now();
    const got = perft(pos, i + 1);
    const ms = performance.now() - t0;
    const ok = got === expected;
    if (!ok) failures++;
    console.log(
      `${ok ? 'OK   ' : 'ÉCHEC'} ${name.padEnd(22)} d${i + 1} ${String(got).padStart(10)} / ${String(expected).padStart(10)}  ${ms.toFixed(0).padStart(6)} ms`,
    );
  });
}
console.log(failures ? `${failures} échec(s)` : 'Tous les tests perft sont corrects.');
process.exit(failures ? 1 : 0);
