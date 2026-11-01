// Time until a front's bomb blows, along its own cord (jumps ignored: good enough to drive pitch).
import { BOMB_TILE_TICKS, FIRE_SPEED, SUB } from '../sim/constants';
import type { FireFront } from '../sim/types';

/** Ticks before the bomb at node 0 explodes if this front keeps going; null when it runs toward the hand. */
export function frontEtaTicks(front: FireFront): number | null {
  if (front.to > front.from) return null;
  const remaining = front.to * SUB + (SUB - front.progress);
  return Math.max(0, remaining) / FIRE_SPEED + BOMB_TILE_TICKS;
}

/** Map an ETA to a sizzle centre frequency: about 700 Hz far away, up to about 4.2 kHz at the blast. */
export function sizzleFrequency(etaTicks: number): number {
  const far = 240; // ≈ 4 s: anything longer sounds the same
  const k = 1 - Math.min(1, etaTicks / far);
  return 700 * Math.pow(6, k);
}

/** Playback rate of the sizzle loop for an ETA: slow and low far away, about twice as fast at the blast. */
export function sizzleRate(etaTicks: number): number {
  const far = 240;
  const k = 1 - Math.min(1, Math.max(0, etaTicks) / far);
  return 0.85 * Math.pow(2.2, k);
}
