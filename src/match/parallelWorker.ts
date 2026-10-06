// Processus fils (Node, child_process.fork) : joue les parties d'un tournoi qu'on lui attribue.
// (Stockfish WASM ne s'initialise pas dans un worker_thread, d'où des processus séparés.)
import { createNodePlayer } from './factoryNode';
import { type TournamentConfig, playTournamentGame } from './tournament';

const config = JSON.parse(process.env.TRUK_TOURNAMENT_CONFIG ?? 'null') as TournamentConfig;
const send = (m: unknown) => process.send!(m);

async function main() {
  const pa = await createNodePlayer(config.a);
  const pb = await createNodePlayer(config.b);
  process.on('message', async (msg: { type: 'play'; index: number } | { type: 'stop' }) => {
    if (msg.type === 'stop') {
      pa.dispose();
      pb.dispose();
      process.exit(0);
    }
    try {
      const rec = await playTournamentGame(config, msg.index, pa, pb);
      send({ type: 'game', index: msg.index, rec });
    } catch (e) {
      send({ type: 'error', index: msg.index, message: (e as Error).message });
    }
  });
  send({ type: 'ready' });
}
void main();
