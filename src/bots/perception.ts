// What a bot knows about upcoming blasts, on a gameplay clock that skips countdown and freeze ticks
// (forecast offsets count gameplay ticks, so both line up).
//
// Reaction delay: threats caused by others are read from the forecast that was current `delay`
// gameplay ticks ago; the bot's own lit bombs and blasts already on the board are known at once.
import { forecast } from '../sim';
import { BLAST_TICKS, GRID_H, GRID_W } from '../sim/constants';
import type { Forecast, GameState, PlayerId, SimEvent } from '../sim/types';
import { N_TILES } from './world';

const EMPTY: Forecast = {
  horizon: 0,
  blastAt: new Int16Array(GRID_W * GRID_H).fill(-1),
  blastUntil: new Int16Array(GRID_W * GRID_H).fill(-1),
  explosions: [],
};

// Bots of one game see the same state objects, so they share forecasts.
const cache = new WeakMap<GameState, Forecast>();

function forecastOf(s: GameState): Forecast {
  if (!s.fronts.length && !s.blasts.length && !s.bombs.some((b) => b.fuse !== null)) return EMPTY;
  let f = cache.get(s);
  if (!f) {
    f = forecast(s);
    cache.set(s, f);
  }
  return f;
}

/** Events the idle forecast cannot predict: they come from players. */
const CHANGES: ReadonlySet<SimEvent['t']> = new Set([
  'bomb-placed',
  'cord-extended',
  'cord-rewound',
  'cord-lit',
  'hand-burnt',
  'player-died',
]);

const REFRESH_EVERY = 120; // re-run before the 360-tick horizon runs out

interface Entry {
  readonly g: number; // gameplay clock when computed
  readonly f: Forecast;
}

export interface DangerMap {
  /** Absolute gameplay ticks; -1 = no known blast. One window per tile (first start, last end). */
  readonly from: Int32Array;
  readonly to: Int32Array;
}

export class Perception {
  /** Gameplay ticks elapsed since the round started playing. */
  g = 0;
  private last: GameState | null = null;
  private entries: Entry[] = [];
  readonly myBombs = new Set<number>();

  constructor(
    private readonly id: PlayerId,
    private readonly delay: number,
  ) {}

  observe(s: GameState): void {
    let prev = this.last;
    if (prev && (s.tick < prev.tick || s.config.seed !== prev.config.seed)) {
      this.reset(); // a new round
      prev = null;
    }
    if (prev && s.tick > prev.tick) {
      const gameplay = (prev.phase === 'playing' || prev.phase === 'resolving') && prev.freeze === 0;
      if (gameplay) this.g += s.tick - prev.tick;
    }
    this.last = s;
    for (const e of s.events) if (e.t === 'bomb-placed' && e.player === this.id) this.myBombs.add(e.bombId);
    const latest = this.entries[this.entries.length - 1];
    const changed = s.events.some((e) => CHANGES.has(e.t));
    if (!latest || changed || this.g - latest.g >= REFRESH_EVERY) this.push(forecastOf(s));
  }

  private reset(): void {
    this.g = 0;
    this.entries = [];
    this.myBombs.clear();
  }

  private push(f: Forecast): void {
    this.entries.push({ g: this.g, f });
    // Keep everything newer than the delay plus the one entry just older than it.
    const cutoff = this.g - this.delay;
    let firstNeeded = 0;
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i]!.g <= cutoff) firstNeeded = i;
    if (firstNeeded > 0) this.entries = this.entries.slice(firstNeeded);
  }

  /** Known blast windows right now. */
  danger(s: GameState): DangerMap {
    const from = new Int32Array(N_TILES).fill(-1);
    const to = new Int32Array(N_TILES).fill(-1);
    const add = (t: number, a: number, b: number): void => {
      if (from[t]! < 0 || a < from[t]!) from[t] = a;
      if (b > to[t]!) to[t] = b;
    };
    // Others' threats, as perceived `delay` ticks ago.
    const cutoff = this.g - this.delay;
    let stale: Entry | undefined;
    for (const e of this.entries) if (e.g <= cutoff) stale = e;
    if (stale) {
      const { f, g } = stale;
      for (let t = 0; t < N_TILES; t++) if (f.blastAt[t]! >= 0) add(t, g + f.blastAt[t]!, g + f.blastUntil[t]!);
    }
    // Own bombs: known immediately.
    const latest = this.entries[this.entries.length - 1];
    if (latest) {
      for (const x of latest.f.explosions) {
        if (!this.myBombs.has(x.bombId)) continue;
        for (const t of x.tiles) add(t, latest.g + x.at, latest.g + x.at + BLAST_TICKS - 1);
      }
    }
    // Blasts on the board: plain to see.
    for (const b of s.blasts) for (const t of b.tiles) add(t, this.g, this.g + b.ticksLeft);
    return { from, to };
  }
}
