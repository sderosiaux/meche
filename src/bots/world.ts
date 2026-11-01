// Read-only views of the sim state that bots plan with: neighbours, blast crosses, blocked tiles.
import { DIRS, DX, DY, tileAt, tileX, tileY } from '../sim';
import { GRID_H, GRID_W, START_RANGE } from '../sim/constants';
import type { Bomb, GameState, Player, Tile } from '../sim/types';

export const N_TILES = GRID_W * GRID_H;

/** Orthogonal neighbours inside the grid, in DIRS order. */
export const NEIGHBOURS: readonly (readonly Tile[])[] = Array.from({ length: N_TILES }, (_, t) => {
  const out: Tile[] = [];
  for (const d of DIRS) {
    const x = tileX(t) + DX[d];
    const y = tileY(t) + DY[d];
    if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) out.push(tileAt(x, y));
  }
  return out;
});

export const manhattan = (a: Tile, b: Tile): number => Math.abs(tileX(a) - tileX(b)) + Math.abs(tileY(a) - tileY(b));

export const rangeOf = (s: GameState, owner: number): number => s.players[owner]?.range ?? START_RANGE;

export const bombOn = (s: GameState, tile: Tile): Bomb | undefined => s.bombs.find((b) => b.tile === tile);

/**
 * Tiles a bomb at `origin` would cover, mirroring the sim (frame/pillar stop before, crate and
 * bomb are included and stop), plus the crosses of bombs it would chain. `extraBomb` lets a bot
 * evaluate a bomb it has not placed yet.
 */
export function crossOf(s: GameState, origin: Tile, range: number): Set<Tile> {
  const out = new Set<Tile>();
  const seen = new Set<Tile>();
  const queue: { tile: Tile; range: number }[] = [{ tile: origin, range }];
  while (queue.length) {
    const { tile, range: r } = queue.shift()!;
    if (seen.has(tile)) continue;
    seen.add(tile);
    out.add(tile);
    const x0 = tileX(tile);
    const y0 = tileY(tile);
    for (const d of DIRS) {
      for (let i = 1; i <= r; i++) {
        const t = tileAt(x0 + DX[d] * i, y0 + DY[d] * i);
        const cell = s.cells[t];
        if (cell === undefined || cell === 'frame' || cell === 'pillar') break;
        out.add(t);
        if (cell === 'crate') break;
        const other = t === origin ? undefined : bombOn(s, t);
        if (other) {
          queue.push({ tile: t, range: rangeOf(s, other.owner) });
          break;
        }
      }
    }
  }
  return out;
}

/** 1 where a bot cannot walk: anything but floor, and bombs (except the one under `me`). */
export function blockedFor(s: GameState, me: Player, meTile: Tile): Uint8Array {
  const blocked = new Uint8Array(N_TILES);
  for (let t = 0; t < N_TILES; t++) if (s.cells[t] !== 'floor') blocked[t] = 1;
  for (const b of s.bombs) if (b.tile !== meTile || !b.walkableBy.includes(me.id)) blocked[b.tile] = 1;
  return blocked;
}
