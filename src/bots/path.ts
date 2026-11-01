// Time-aware grid search. A node is (tile, step); one step = the ticks needed to walk one tile.
// Standing on a tile during a step must not overlap that tile's known blast window.
import type { Tile } from '../sim/types';
import type { DangerMap } from './perception';
import { N_TILES, NEIGHBOURS } from './world';

export interface PlanCtx {
  readonly blocked: Uint8Array;
  readonly danger: DangerMap;
  /** Gameplay clock now. */
  readonly g: number;
  /** Ticks per tile. */
  readonly tpt: number;
  /** Extra ticks kept clear on both sides of a blast window. */
  readonly margin: number;
}

export const MAX_STEPS = 24;

// A step nominally reaches the next tile center at time T. The center tile actually switches
// earlier (the bot may already be past its own center) and the bot may leave later (lane
// realignment), so occupancy is taken as one tile of slack on each side.
const enterAt = (ctx: PlanCtx, T: number): number => T - ctx.tpt + 1;
const leaveAt = (ctx: PlanCtx, T: number): number => T + ctx.tpt;

/** Is the tile hit while we occupy it during [a, b]? */
export function hitDuring(ctx: PlanCtx, t: Tile, a: number, b: number): boolean {
  const from = ctx.danger.from[t]!;
  if (from < 0) return false;
  return a <= ctx.danger.to[t]! + ctx.margin && b >= from - ctx.margin;
}

/** Can we stand on the tile from `a` on, for as long as anything is known? */
export function safeFrom(ctx: PlanCtx, t: Tile, a: number): boolean {
  const from = ctx.danger.from[t]!;
  return from < 0 || ctx.danger.to[t]! + ctx.margin < a;
}

export interface PathOpts {
  /** Steps already elapsed when the search starts at `start` (for "what if I were there then"). */
  readonly startStep?: number;
  readonly maxSteps?: number;
  /** Goal tiles must also satisfy safeFrom at arrival. Default true. */
  readonly goalMustStaySafe?: boolean;
}

/**
 * Shortest (fewest steps, waits allowed) safe walk from `start` to a tile accepted by `goal`.
 * Returns the tiles to occupy step by step (a repeated tile = wait), without `start`; [] if the
 * start already qualifies; null if unreachable within the horizon.
 */
export function findPath(ctx: PlanCtx, start: Tile, goal: (t: Tile) => boolean, opts: PathOpts = {}): Tile[] | null {
  const s0 = opts.startStep ?? 0;
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const mustStay = opts.goalMustStaySafe ?? true;
  const timeOf = (k: number): number => ctx.g + (s0 + k) * ctx.tpt;
  const accepts = (t: Tile, k: number): boolean => goal(t) && (!mustStay || safeFrom(ctx, t, enterAt(ctx, timeOf(k))));
  if (accepts(start, 0)) return [];

  const parent = new Int32Array((maxSteps + 1) * N_TILES).fill(-1);
  let frontier: Tile[] = [start];
  parent[start] = start;
  for (let k = 1; k <= maxSteps; k++) {
    const next: Tile[] = [];
    const base = k * N_TILES;
    const a = enterAt(ctx, timeOf(k));
    const b = leaveAt(ctx, timeOf(k));
    for (const from of frontier) {
      // Waiting first keeps paths short when a blast is about to pass.
      const options = [from, ...NEIGHBOURS[from]!];
      for (const t of options) {
        if (t !== from && ctx.blocked[t]) continue;
        if (parent[base + t] !== -1) continue;
        if (hitDuring(ctx, t, t === from ? timeOf(k - 1) : a, b)) continue;
        parent[base + t] = (k - 1) * N_TILES + from;
        if (accepts(t, k)) return unwind(parent, base + t);
        next.push(t);
      }
    }
    if (!next.length) return null;
    frontier = next;
  }
  return null;
}

function unwind(parent: Int32Array, node: number): Tile[] {
  const path: Tile[] = [];
  let n = node;
  while (n >= N_TILES) {
    path.push(n % N_TILES);
    n = parent[n]!;
  }
  path.reverse();
  return path;
}

/** Earliest safe arrival step for every reachable tile (-1 if none), with the same rules. */
export function reachSteps(ctx: PlanCtx, start: Tile, maxSteps: number): Int16Array {
  const steps = new Int16Array(N_TILES).fill(-1);
  steps[start] = 0;
  let frontier: Tile[] = [start];
  const seen = new Uint8Array((maxSteps + 1) * N_TILES);
  seen[start] = 1;
  for (let k = 1; k <= maxSteps && frontier.length; k++) {
    const next: Tile[] = [];
    const t0 = ctx.g + k * ctx.tpt;
    for (const from of frontier) {
      for (const t of [from, ...NEIGHBOURS[from]!]) {
        if (t !== from && ctx.blocked[t]) continue;
        const key = k * N_TILES + t;
        if (seen[key]) continue;
        if (hitDuring(ctx, t, t === from ? t0 - ctx.tpt : enterAt(ctx, t0), leaveAt(ctx, t0))) continue;
        seen[key] = 1;
        if (steps[t]! < 0) steps[t] = k;
        next.push(t);
      }
    }
    frontier = next;
  }
  return steps;
}
