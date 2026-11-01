import { CRATE_DENSITY_PERMILLE, GRID_H, GRID_W } from './constants';
import { tileAt } from './grid';
import { nextU32 } from './rng';
import type { Cell, PlayerId, Tile } from './types';

export const SPAWNS: Readonly<Record<PlayerId, readonly [number, number]>> = {
  0: [1, 1],
  1: [GRID_W - 2, 1],
  2: [1, GRID_H - 2],
  3: [GRID_W - 2, GRID_H - 2],
};

function baseCell(x: number, y: number): Cell {
  if (x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1) return 'frame';
  if (x % 2 === 0 && y % 2 === 0) return 'pillar';
  return 'floor';
}

/** Each spawn keeps its corner and its two orthogonal neighbours free. The set is mirror-symmetric. */
export function safeTiles(): Set<Tile> {
  const safe = new Set<Tile>();
  for (const [x, y] of Object.values(SPAWNS)) {
    safe.add(tileAt(x, y));
    safe.add(tileAt(x + (x === 1 ? 1 : -1), y));
    safe.add(tileAt(x, y + (y === 1 ? 1 : -1)));
  }
  return safe;
}

/**
 * Crates are drawn for the top-left quadrant (x 1..7, y 1..6) in row-major order, then mirrored
 * on x → W-1-x and y → H-1-y. The center column and row are their own mirror.
 */
export function buildArena(holder: { rng: number }): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) cells.push(baseCell(x, y));
  const safe = safeTiles();
  const midX = (GRID_W - 1) / 2;
  const midY = (GRID_H - 1) / 2;
  for (let y = 1; y <= midY; y++) {
    for (let x = 1; x <= midX; x++) {
      if (cells[tileAt(x, y)] !== 'floor' || safe.has(tileAt(x, y))) continue;
      if (nextU32(holder) % 1000 >= CRATE_DENSITY_PERMILLE) continue;
      const mx = GRID_W - 1 - x;
      const my = GRID_H - 1 - y;
      for (const t of [tileAt(x, y), tileAt(mx, y), tileAt(x, my), tileAt(mx, my)]) cells[t] = 'crate';
    }
  }
  return cells;
}
