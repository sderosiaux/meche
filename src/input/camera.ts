// Camera-relative controls (spec §20): with the view turned by `quarter` quarter turns, "up" still
// moves the doll toward the back of the screen. Pure, so it is unit-tested.
import type { Dir } from '../sim/types';

/** World directions clockwise seen from above: up = -z (back of the default view), right = +x. */
const CYCLE: readonly Dir[] = ['up', 'right', 'down', 'left'];

export function cameraRelativeDir(dir: Dir | null, quarter: number): Dir | null {
  if (dir === null) return null;
  const i = CYCLE.indexOf(dir);
  const k = ((Math.round(quarter) % 4) + 4) % 4;
  return CYCLE[(i - k + 4) % 4]!;
}
