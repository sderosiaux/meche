// Classic Bomberman lanes with cornering assist. Positions are tile centers in sub-units.
import { CORNER_ASSIST, SUB } from './constants';
import { HALF, tileAt } from './grid';
import type { Dir, GameState, Player, Tile } from './types';
import { bombAt } from './world';

/** Floor without a bomb, or a bomb tile the player is allowed on: still standing on it since
 * placement, or holding its cord (so the cord can be reeled in to length 0, spec L2/§26). */
export function passable(s: GameState, p: Player, tile: Tile): boolean {
  if (s.cells[tile] !== 'floor') return false;
  const bomb = bombAt(s, tile);
  return !bomb || bomb.walkableBy.includes(p.id) || (p.heldCord !== null && bomb.cordId === p.heldCord);
}

export function movePlayer(s: GameState, p: Player, dir: Dir | null): void {
  p.moving = false;
  if (!dir) return;
  p.facing = dir;
  const tx = Math.floor(p.x / SUB);
  const ty = Math.floor(p.y / SUB);
  const horizontal = dir === 'left' || dir === 'right';
  const d = dir === 'right' || dir === 'down' ? 1 : -1;
  const next = horizontal ? tileAt(tx + d, ty) : tileAt(tx, ty + d);

  // Off-lane on the other axis: slide back to the lane center if close enough and the turn is open.
  const laneOff = horizontal ? p.y - (ty * SUB + HALF) : p.x - (tx * SUB + HALF);
  if (laneOff !== 0) {
    if (Math.abs(laneOff) > CORNER_ASSIST || !passable(s, p, next)) return;
    const slide = Math.min(p.speed, Math.abs(laneOff)) * Math.sign(laneOff);
    if (horizontal) p.y -= slide;
    else p.x -= slide;
    p.moving = true;
    return;
  }

  const coord = horizontal ? p.x : p.y;
  const center = (horizontal ? tx : ty) * SUB + HALF;
  let target: number;
  if (passable(s, p, next)) {
    target = coord + d * p.speed;
  } else {
    // Blocked ahead: may only move toward the current tile center.
    if ((coord - center) * d >= 0) return;
    target = d > 0 ? Math.min(coord + p.speed, center) : Math.max(coord - p.speed, center);
  }
  if (horizontal) p.x = target;
  else p.y = target;
  p.moving = target !== coord;
}
