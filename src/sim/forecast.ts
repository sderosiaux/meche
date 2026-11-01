import { FORECAST_HORIZON_TICKS, GRID_H, GRID_W } from './constants';
import { stepMut } from './step';
import type { Forecast, GameState, Tile } from './types';

const IDLE: readonly [] = [];

/** Run the future with nobody pressing anything and nobody dying. Offset 0 is the given state. */
export function forecast(state: GameState, horizon: number = FORECAST_HORIZON_TICKS): Forecast {
  const s = structuredClone(state);
  s.events = [];
  const blastAt = new Int16Array(GRID_W * GRID_H).fill(-1);
  const blastUntil = new Int16Array(GRID_W * GRID_H).fill(-1);
  const explosions: { bombId: number; at: number; tiles: readonly Tile[] }[] = [];
  const mark = (k: number): void => {
    for (const b of s.blasts) {
      for (const t of b.tiles) {
        if (blastAt[t]! < 0) blastAt[t] = k;
        blastUntil[t] = k;
      }
    }
  };
  mark(0);
  for (let k = 1; k <= horizon; k++) {
    // Held cords stay held, so once nothing burns nothing will ever change.
    if (!s.blasts.length && !s.fronts.length && !s.bombs.some((b) => b.fuse !== null)) break;
    stepMut(s, IDLE, { invulnerable: true, ignorePhase: true });
    for (const e of s.events) {
      if (e.t !== 'explosion') continue;
      const x = s.explosions.find((ex) => ex.id === e.explosionId);
      if (x) explosions.push({ bombId: x.bombId, at: k, tiles: x.tiles });
    }
    mark(k);
  }
  return { horizon, blastAt, blastUntil, explosions };
}
