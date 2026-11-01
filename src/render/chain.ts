// Causal chain of a death (spec §21): which crosses, which bombs, which burnt path, and who lit it.
// Pure so it can be tested without WebGL.
import type { Explosion, GameState, PlayerId, Tile } from '../sim/types';

export interface DeathChain {
  readonly crossTiles: ReadonlySet<Tile>;
  readonly bombTiles: ReadonlySet<Tile>;
  readonly trailTiles: ReadonlySet<Tile>;
  /** Ignition points, each in the colour of whoever lit it (null = nobody, e.g. neutral). */
  readonly stars: ReadonlyArray<{ readonly tile: Tile; readonly by: PlayerId | null }>;
}

export function resolveDeathChain(state: GameState, explosionId: number): DeathChain {
  const byId = new Map<number, Explosion>(state.explosions.map((e) => [e.id, e]));
  const crossTiles = new Set<Tile>();
  const bombTiles = new Set<Tile>();
  const trailTiles = new Set<Tile>();
  const stars: { tile: Tile; by: PlayerId | null }[] = [];
  const seen = new Set<number>();
  const pending: number[] = [explosionId];

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const ex = byId.get(id);
    if (!ex) continue;
    ex.tiles.forEach((t) => crossTiles.add(t));
    bombTiles.add(ex.tile);
    const trigger = ex.trigger;
    if (trigger.kind === 'chain') {
      pending.push(trigger.byExplosion);
      continue;
    }
    trigger.trail.forEach((t) => trailTiles.add(t));
    const ign = trigger.ignition;
    if (!stars.some((s) => s.tile === ign.tile && s.by === ign.by)) stars.push({ tile: ign.tile, by: ign.by });
    if (ign.kind === 'blast' && ign.explosionId !== null) pending.push(ign.explosionId);
  }

  return { crossTiles, bombTiles, trailTiles, stars };
}
