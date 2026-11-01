import { GRID_W, SUB } from './constants';
import type { Dir, Tile } from './types';

export const HALF = SUB / 2;

export const tileAt = (tx: number, ty: number): Tile => ty * GRID_W + tx;
export const tileX = (tile: Tile): number => tile % GRID_W;
export const tileY = (tile: Tile): number => Math.floor(tile / GRID_W);
/** Tile containing a point given in sub-units. */
export const tileOf = (x: number, y: number): Tile => tileAt(Math.floor(x / SUB), Math.floor(y / SUB));
/** Sub-unit coordinate of the center of tile column/row `c`. */
export const centerOf = (c: number): number => c * SUB + HALF;

/** Fixed order used everywhere a direction loop must be deterministic. */
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
export const DX: Readonly<Record<Dir, number>> = { up: 0, down: 0, left: -1, right: 1 };
export const DY: Readonly<Record<Dir, number>> = { up: -1, down: 1, left: 0, right: 0 };
