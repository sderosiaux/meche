// L3/L4: lighting cords and moving fire along them.
import { BOMB_TILE_TICKS, FIRE_SPEED, SUB } from './constants';
import { HALF } from './grid';
import type { Cord, FireFront, GameState, Ignition, IgnitionKind, Player, Tile } from './types';
import { cordById, emit, newId } from './world';

export function releaseCord(s: GameState, cord: Cord): void {
  cord.held = false;
  const p = s.players[cord.owner];
  if (p && p.heldCord === cord.id) {
    p.heldCord = null;
    p.heldSince = null;
  }
}

function startFuse(s: GameState, bombId: number, ignition: Ignition, trail: readonly Tile[]): void {
  const bomb = s.bombs.find((b) => b.id === bombId);
  if (!bomb || bomb.fuse !== null) return;
  bomb.fuse = BOMB_TILE_TICKS;
  bomb.fireCause = { ignition, trail };
  emit(s, { t: 'bomb-fuse', bombId });
}

/**
 * Fronts toward unburnt neighbours. Toward a burnt neighbour only when a front is already coming
 * from it: the two then meet mid-segment and annihilate instead of one running the whole way.
 */
function spawnFronts(s: GameState, cord: Cord, idx: number, ignition: Ignition, trail: readonly Tile[]): void {
  for (const n of [idx - 1, idx + 1]) {
    const node = cord.nodes[n];
    if (!node) continue;
    if (node.burnt && !s.fronts.some((f) => f.cordId === cord.id && f.from === n && f.to === idx)) continue;
    if (s.fronts.some((f) => f.cordId === cord.id && f.from === idx && f.to === n)) continue;
    s.fronts.push({ id: newId(s), cordId: cord.id, from: idx, to: n, progress: 0, ignition, trail });
  }
}

/**
 * Burn one node and propagate: fuse if it is the bomb node, release if it is a held hand,
 * fronts toward unburnt neighbours, then every other unburnt node on the same tile (any cord,
 * including this one elsewhere in its path = knot). Cords are scanned in array (id) order.
 */
export function burnNode(
  s: GameState,
  cord: Cord,
  idx: number,
  ignition: Ignition,
  trail: readonly Tile[],
  from?: { readonly cordId: number; readonly idx: number },
): void {
  const node = cord.nodes[idx];
  if (!node || node.burnt) return;
  node.burnt = true;
  if (from && (from.cordId !== cord.id || from.idx !== idx)) {
    emit(s, { t: 'fire-jump', tile: node.tile, fromCord: from.cordId, toCord: cord.id });
  }
  if (idx === 0) startFuse(s, cord.bombId, ignition, trail);
  if (cord.held && idx === cord.nodes.length - 1) {
    releaseCord(s, cord);
    emit(s, { t: 'hand-burnt', cordId: cord.id, player: cord.owner });
  }
  spawnFronts(s, cord, idx, ignition, trail);
  for (const other of s.cords) {
    for (let k = 0; k < other.nodes.length; k++) {
      const o = other.nodes[k]!;
      if (!o.burnt && o.tile === node.tile) burnNode(s, other, k, ignition, trail, { cordId: cord.id, idx });
    }
  }
}

/** Root ignition of a node by something outside the cord network (blast). */
export function igniteNode(s: GameState, cord: Cord, idx: number, ignition: Ignition): void {
  const node = cord.nodes[idx];
  if (!node || node.burnt) return;
  emit(s, { t: 'cord-lit', cordId: cord.id, ignition });
  burnNode(s, cord, idx, ignition, [node.tile]);
}

/** Light the held cord at the hand end and let go of it. */
export function lightHeld(s: GameState, p: Player, kind: IgnitionKind): void {
  if (p.heldCord === null) return;
  const cord = cordById(s, p.heldCord);
  if (!cord) {
    p.heldCord = null;
    p.heldSince = null;
    return;
  }
  const idx = cord.nodes.length - 1;
  const tile = cord.nodes[idx]!.tile;
  releaseCord(s, cord);
  const ignition: Ignition = { kind, by: p.id, tile, tick: s.tick, explosionId: null };
  emit(s, { t: 'cord-lit', cordId: cord.id, ignition });
  burnNode(s, cord, idx, ignition, [tile]);
}

/** Tile a front currently stands on: the tile it left until halfway, then the tile it heads to. */
export function frontTile(s: GameState, f: FireFront): Tile | null {
  const cord = cordById(s, f.cordId);
  const a = cord?.nodes[f.from];
  const b = cord?.nodes[f.to];
  if (!a || !b) return null;
  return f.progress < HALF ? a.tile : b.tile;
}

export function tileHasFire(s: GameState, tile: Tile): boolean {
  if (s.blasts.some((b) => b.tiles.includes(tile))) return true;
  return s.fronts.some((f) => frontTile(s, f) === tile);
}

/**
 * Fronts present at the start of the phase advance by FIRE_SPEED (fronts spawned during this
 * phase wait for the next tick). Opposite fronts on one segment annihilate when they meet;
 * the others arrive in front-id order.
 */
export function advanceFronts(s: GameState): void {
  const moving = s.fronts.slice();
  for (const f of moving) f.progress += FIRE_SPEED;
  const gone = new Set<number>();
  for (let i = 0; i < moving.length; i++) {
    const f = moving[i]!;
    for (let j = i + 1; j < moving.length; j++) {
      const g = moving[j]!;
      if (f.cordId === g.cordId && f.from === g.to && f.to === g.from && f.progress + g.progress >= SUB) {
        gone.add(f.id);
        gone.add(g.id);
      }
    }
  }
  const arrivals = moving.filter((f) => !gone.has(f.id) && f.progress >= SUB);
  for (const f of arrivals) gone.add(f.id);
  if (gone.size) s.fronts = s.fronts.filter((f) => !gone.has(f.id));
  for (const f of arrivals) {
    const cord = cordById(s, f.cordId);
    const node = cord?.nodes[f.to];
    if (!cord || !node || node.burnt) continue;
    burnNode(s, cord, f.to, f.ignition, [...f.trail, node.tile], { cordId: cord.id, idx: f.to });
  }
}
