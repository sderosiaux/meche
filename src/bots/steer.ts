// Turn "go to the next tile" into a direction the sim's lane movement accepts.
import { centerOf, tileX, tileY } from '../sim';
import { CORNER_ASSIST } from '../sim/constants';
import type { Dir, Player, Tile } from '../sim/types';

/**
 * Direction toward the adjacent tile `next` from the player's current tile `here`. When the player
 * is too far off the lane for the cornering assist, it first walks back to the tile center.
 */
export function steer(p: Player, here: Tile, next: Tile): Dir | null {
  const dx = tileX(next) - tileX(here);
  const dy = tileY(next) - tileY(here);
  if (dx !== 0) {
    const off = p.y - centerOf(tileY(here));
    if (Math.abs(off) > CORNER_ASSIST) return off > 0 ? 'up' : 'down';
    return dx > 0 ? 'right' : 'left';
  }
  if (dy !== 0) {
    const off = p.x - centerOf(tileX(here));
    if (Math.abs(off) > CORNER_ASSIST) return off > 0 ? 'left' : 'right';
    return dy > 0 ? 'down' : 'up';
  }
  return null;
}

/** Back to the center of the current tile, so a stop never sits on the edge of the next one. */
export function recenter(p: Player, here: Tile): Dir | null {
  const offX = p.x - centerOf(tileX(here));
  const offY = p.y - centerOf(tileY(here));
  if (offX !== 0) return offX > 0 ? 'left' : 'right';
  if (offY !== 0) return offY > 0 ? 'up' : 'down';
  return null;
}
