import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En-têtes COOP/COEP : rendent la page « cross-origin isolated », ce qui autorise
// SharedArrayBuffer et donc la variante multi-thread de Stockfish WASM.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation, port: 5173 },
  preview: { headers: isolation, port: 4173 },
  worker: { format: 'es' },
});
