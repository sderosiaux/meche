// Sim space (sub-units, tiles) → world space (1 world unit = 1 tile, board centred on the origin,
// x to the right, z toward the camera, y up).
import { GRID_H, GRID_W, SUB } from '../sim/constants';
import type { Tile } from '../sim/types';

export const worldX = (sub: number): number => sub / SUB - GRID_W / 2;
export const worldZ = (sub: number): number => sub / SUB - GRID_H / 2;

export const tileCol = (tile: Tile): number => tile % GRID_W;
export const tileRow = (tile: Tile): number => Math.floor(tile / GRID_W);

export const tileWorldX = (tile: Tile): number => tileCol(tile) + 0.5 - GRID_W / 2;
export const tileWorldZ = (tile: Tile): number => tileRow(tile) + 0.5 - GRID_H / 2;
