// Client UCI générique (indépendant du transport : Web Worker dans le navigateur, module WASM dans Node).
// Sert à piloter Stockfish comme adversaire / outil d'analyse. Notre moteur ne l'utilise jamais pour choisir ses coups.

export interface UciTransport {
  send(cmd: string): void;
  setListener(cb: (line: string) => void): void;
  terminate(): void;
}

export interface UciOption {
  name: string;
  type: string;
  default?: string;
  min?: number;
  max?: number;
}

export interface UciLimits {
  depth?: number;
  nodes?: number;
  movetime?: number;
}

export interface UciInfo {
  depth: number;
  seldepth: number;
  /** Score du point de vue du camp au trait (centipawns) ; null si mat. */
  scoreCp: number | null;
  mate: number | null;
  bound?: 'lower' | 'upper';
  nodes: number;
  nps: number;
  timeMs: number;
  hashfull: number;
  pv: string[];
  multipv: number;
}

export interface UciResult extends UciInfo {
  bestMove: string | null;
  ponder: string | null;
}

export function parseInfoLine(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  const info: UciInfo = {
    depth: 0,
    seldepth: 0,
    scoreCp: null,
    mate: null,
    nodes: 0,
    nps: 0,
    timeMs: 0,
    hashfull: 0,
    pv: [],
    multipv: 1,
  };
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = Number(t[++i]);
        break;
      case 'seldepth':
        info.seldepth = Number(t[++i]);
        break;
      case 'multipv':
        info.multipv = Number(t[++i]);
        break;
      case 'nodes':
        info.nodes = Number(t[++i]);
        break;
      case 'nps':
        info.nps = Number(t[++i]);
        break;
      case 'time':
        info.timeMs = Number(t[++i]);
        break;
      case 'hashfull':
        info.hashfull = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        hasScore = true;
        if (kind === 'cp') info.scoreCp = v;
        else if (kind === 'mate') info.mate = v;
        if (t[i + 1] === 'lowerbound') {
          info.bound = 'lower';
          i++;
        } else if (t[i + 1] === 'upperbound') {
          info.bound = 'upper';
          i++;
        }
        break;
      }
      case 'pv':
        info.pv = t.slice(i + 1);
        i = t.length;
        break;
      case 'string':
      case 'currmove':
      case 'currmovenumber':
      case 'wdl':
        if (t[i] === 'string') return null;
        if (t[i] === 'wdl') i += 3;
        else i++;
        break;
      default:
        break;
    }
  }
  if (!hasScore) return null;
  return info;
}

export function parseOptionLine(line: string): UciOption | null {
  const m = /^option name (.+?) type (\w+)(.*)$/.exec(line);
  if (!m) return null;
  const opt: UciOption = { name: m[1], type: m[2] };
  const rest = m[3];
  const d = /default (\S*)/.exec(rest);
  if (d) opt.default = d[1];
  const mn = /min (-?\d+)/.exec(rest);
  if (mn) opt.min = Number(mn[1]);
  const mx = /max (-?\d+)/.exec(rest);
  if (mx) opt.max = Number(mx[1]);
  return opt;
}

/**
 * Pilote UCI : une seule recherche à la fois ; les commandes sont sérialisées.
 */
export class UciEngine {
  name = '';
  options: UciOption[] = [];
  private waiters: { pred: (l: string) => boolean; resolve: (l: string) => void }[] = [];
  private infoCb: ((i: UciInfo) => void) | null = null;
  private lastInfo: UciInfo | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private dead = false;
  log: string[] = [];

  constructor(private transport: UciTransport) {
    transport.setListener((line) => this.onLine(line));
  }

  private onLine(raw: string): void {
    for (const line of String(raw).split('\n')) {
      const l = line.trim();
      if (!l) continue;
      if (this.log.length > 200) this.log.shift();
      this.log.push(l);
      if (l.startsWith('id name ')) this.name = l.slice(8);
      else if (l.startsWith('option ')) {
        const o = parseOptionLine(l);
        if (o) this.options.push(o);
      } else if (l.startsWith('info ')) {
        const info = parseInfoLine(l);
        if (info && info.multipv === 1 && info.pv.length) {
          this.lastInfo = info;
          this.infoCb?.(info);
        }
      }
      const idx = this.waiters.findIndex((w) => w.pred(l));
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        w.resolve(l);
      }
    }
  }

  private waitFor(pred: (l: string) => boolean, timeoutMs = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      if (timeoutMs > 0) {
        setTimeout(() => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            reject(new Error('Délai UCI dépassé'));
          }
        }, timeoutMs);
      }
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  hasOption(name: string): UciOption | undefined {
    return this.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
  }

  init(timeoutMs = 60000): Promise<void> {
    return this.enqueue(async () => {
      this.options = [];
      const p = this.waitFor((l) => l === 'uciok', timeoutMs);
      this.transport.send('uci');
      await p;
    });
  }

  isReady(timeoutMs = 60000): Promise<void> {
    return this.enqueue(() => this.readyRaw(timeoutMs));
  }

  private async readyRaw(timeoutMs = 60000): Promise<void> {
    const p = this.waitFor((l) => l === 'readyok', timeoutMs);
    this.transport.send('isready');
    await p;
  }

  setOption(name: string, value: string | number | boolean): Promise<void> {
    return this.enqueue(async () => {
      this.transport.send(`setoption name ${name} value ${value}`);
      await this.readyRaw();
    });
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      this.transport.send('ucinewgame');
      await this.readyRaw();
    });
  }

  go(startFen: string, moves: string[], limits: UciLimits, onInfo?: (i: UciInfo) => void): Promise<UciResult> {
    return this.enqueue(async () => {
      if (this.dead) throw new Error('Moteur UCI arrêté');
      this.lastInfo = null;
      this.infoCb = onInfo ?? null;
      const pos = `position fen ${startFen}` + (moves.length ? ` moves ${moves.join(' ')}` : '');
      this.transport.send(pos);
      let go = 'go';
      if (limits.depth) go += ` depth ${limits.depth}`;
      if (limits.nodes) go += ` nodes ${limits.nodes}`;
      if (limits.movetime) go += ` movetime ${limits.movetime}`;
      if (go === 'go') go += ' depth 10';
      const p = this.waitFor((l) => l.startsWith('bestmove'));
      this.transport.send(go);
      const line = await p;
      this.infoCb = null;
      const parts = line.split(/\s+/);
      const bm = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      const ponder = parts[2] === 'ponder' ? parts[3] : null;
      const info: UciInfo = this.lastInfo ?? {
        depth: 0,
        seldepth: 0,
        scoreCp: null,
        mate: null,
        nodes: 0,
        nps: 0,
        timeMs: 0,
        hashfull: 0,
        pv: [],
        multipv: 1,
      };
      return { ...info, bestMove: bm, ponder };
    });
  }

  stop(): void {
    this.transport.send('stop');
  }

  quit(): void {
    this.dead = true;
    try {
      this.transport.send('quit');
    } catch {
      /* ignoré */
    }
    this.transport.terminate();
  }
}
