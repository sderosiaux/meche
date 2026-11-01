// Turns cords and fire fronts into world-space pieces to draw. Pure (tested in tests/view).
import { SUB } from '../sim/constants';
import type { Cord, FireFront, GameState, PlayerId, Tile } from '../sim/types';
import { tileWorldX, tileWorldZ, worldX, worldZ } from './coords';

export interface CordPiece {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly owner: PlayerId;
  readonly cordId: number;
}

export interface FirePoint {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly cordId: number;
  /** True when the front moves toward the bomb (node index decreasing). */
  readonly towardBomb: boolean;
}

/** Progress of a front at render time, interpolated with the previous state when it is the same front. */
export function frontProgress(front: FireFront, prev: GameState | null, alpha: number): number {
  const before = prev?.fronts.find((f) => f.id === front.id);
  if (!before || before.from !== front.from || before.to !== front.to) return front.progress;
  return before.progress + (front.progress - before.progress) * alpha;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function nodeTile(cord: Cord, index: number): Tile | null {
  return cord.nodes[index]?.tile ?? null;
}

export function firePoints(state: GameState, prev: GameState | null, alpha: number): FirePoint[] {
  const cords = new Map(state.cords.map((c) => [c.id, c]));
  const out: FirePoint[] = [];
  for (const f of state.fronts) {
    const cord = cords.get(f.cordId);
    if (!cord) continue;
    const a = nodeTile(cord, f.from);
    const b = nodeTile(cord, f.to);
    if (a === null || b === null) continue;
    const t = Math.min(1, Math.max(0, frontProgress(f, prev, alpha) / SUB));
    out.push({
      id: f.id,
      x: lerp(tileWorldX(a), tileWorldX(b), t),
      z: lerp(tileWorldZ(a), tileWorldZ(b), t),
      cordId: f.cordId,
      towardBomb: f.to < f.from,
    });
  }
  return out;
}

/**
 * Unburnt parts of every cord. `hands` gives the interpolated position of each holder so the
 * held end follows the doll instead of snapping to tile centres.
 */
export function cordPieces(
  state: GameState,
  prev: GameState | null,
  alpha: number,
  hands: ReadonlyMap<PlayerId, { x: number; z: number }>,
): CordPiece[] {
  const out: CordPiece[] = [];
  for (const cord of state.cords) {
    const fronts = state.fronts.filter((f) => f.cordId === cord.id);
    for (let i = 0; i + 1 < cord.nodes.length; i++) {
      const n0 = cord.nodes[i]!;
      const n1 = cord.nodes[i + 1]!;
      let s = 0;
      let e = 1;
      let touched = false;
      for (const f of fronts) {
        const p = Math.min(1, Math.max(0, frontProgress(f, prev, alpha) / SUB));
        if (f.from === i && f.to === i + 1) {
          s = Math.max(s, p);
          touched = true;
        } else if (f.from === i + 1 && f.to === i) {
          e = Math.min(e, 1 - p);
          touched = true;
        }
      }
      if (!touched && n0.burnt && n1.burnt) continue;
      if (s >= e) continue;
      const ax = tileWorldX(n0.tile);
      const az = tileWorldZ(n0.tile);
      const bx = tileWorldX(n1.tile);
      const bz = tileWorldZ(n1.tile);
      out.push({ ax: lerp(ax, bx, s), az: lerp(az, bz, s), bx: lerp(ax, bx, e), bz: lerp(az, bz, e), owner: cord.owner, cordId: cord.id });
    }
    const last = cord.nodes[cord.nodes.length - 1];
    const hand = cord.held ? hands.get(cord.owner) : undefined;
    if (last && !last.burnt && hand) {
      out.push({ ax: tileWorldX(last.tile), az: tileWorldZ(last.tile), bx: hand.x, bz: hand.z, owner: cord.owner, cordId: cord.id });
    }
  }
  return out;
}

/** Tiles where at least two unburnt cord nodes overlap: fire passes there (L4). */
export function knotTiles(state: GameState): Tile[] {
  const counts = new Map<Tile, number>();
  for (const cord of state.cords) {
    for (const n of cord.nodes) {
      if (!n.burnt) counts.set(n.tile, (counts.get(n.tile) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).map(([t]) => t);
}

export function playerWorld(x: number, y: number): { x: number; z: number } {
  return { x: worldX(x), z: worldZ(y) };
}
