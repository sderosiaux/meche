// L5: fuses, explosions, lingering blasts.
import { BLAST_TICKS, DEATH_FREEZE_TICKS, START_RANGE } from './constants';
import { igniteNode, lightHeld, releaseCord } from './fire';
import { DIRS, DX, DY, tileAt, tileX, tileY } from './grid';
import type { Bomb, ExplosionTrigger, GameState, Player, Tile } from './types';
import { bombAt, emit, newId, playerTile } from './world';

/** Per-tick scratch: crates hit this tick keep stopping every explosion of the tick. */
export interface TickCtx {
  readonly crates: Set<Tile>;
}

/** Crates hit during the tick turn to floor only once every explosion of the tick is resolved. */
export function clearHitCrates(s: GameState, ctx: TickCtx): void {
  for (const t of ctx.crates) s.cells[t] = 'floor';
  ctx.crates.clear();
}

/** Explode a bomb and, in the same tick, every bomb its cross reaches (breadth-first). */
export function explode(s: GameState, first: Bomb, firstTrigger: ExplosionTrigger, ctx: TickCtx): void {
  const queue: { bomb: Bomb; trigger: ExplosionTrigger }[] = [{ bomb: first, trigger: firstTrigger }];
  while (queue.length) {
    const { bomb, trigger } = queue.shift()!;
    if (!s.bombs.includes(bomb)) continue;
    s.bombs = s.bombs.filter((b) => b !== bomb);
    // The holder lets go when its bomb is gone; what is left of the cord still burns from node 0.
    const cord = s.cords.find((c) => c.id === bomb.cordId);
    if (cord?.held) releaseCord(s, cord);
    const id = newId(s);
    const range = s.players[bomb.owner]?.range ?? START_RANGE;
    const x0 = tileX(bomb.tile);
    const y0 = tileY(bomb.tile);
    const tiles: Tile[] = [bomb.tile];
    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const t = tileAt(x0 + DX[dir] * i, y0 + DY[dir] * i);
        const cell = s.cells[t];
        if (cell === undefined || cell === 'frame' || cell === 'pillar') break;
        if (cell === 'crate') {
          tiles.push(t);
          if (!ctx.crates.has(t)) {
            ctx.crates.add(t);
            emit(s, { t: 'crate-destroyed', tile: t });
          }
          break;
        }
        const other = bombAt(s, t);
        if (other) {
          tiles.push(t);
          queue.push({ bomb: other, trigger: { kind: 'chain', byExplosion: id } });
          break;
        }
        tiles.push(t);
      }
    }
    s.explosions.push({ id, bombId: bomb.id, owner: bomb.owner, tile: bomb.tile, tiles, tick: s.tick, trigger });
    s.blasts.push({ explosionId: id, tiles, ticksLeft: BLAST_TICKS });
    emit(s, { t: 'explosion', explosionId: id });
  }
}

export function decayBlasts(s: GameState): void {
  if (!s.blasts.length) return;
  for (const b of s.blasts) b.ticksLeft -= 1;
  s.blasts = s.blasts.filter((b) => b.ticksLeft > 0);
}

export function tickFuses(s: GameState, ctx: TickCtx): void {
  const due: Bomb[] = [];
  for (const b of s.bombs) {
    if (b.fuse === null) continue;
    b.fuse -= 1;
    if (b.fuse <= 0) due.push(b);
  }
  for (const b of due) {
    if (!b.fireCause) throw new Error(`bomb ${b.id} burning without a recorded fire`);
    explode(s, b, { kind: 'fire', ignition: b.fireCause.ignition, trail: b.fireCause.trail }, ctx);
  }
}

function kill(s: GameState, p: Player, explosionId: number): void {
  p.alive = false;
  p.moving = false;
  p.diedAt = s.tick;
  s.deaths.push({ player: p.id, tick: s.tick, explosionId });
  emit(s, { t: 'player-died', player: p.id, explosionId });
  s.freeze = DEATH_FREEZE_TICKS;
  if (p.heldCord !== null) lightHeld(s, p, 'holder-died');
}

/**
 * Every active blast, each tick: (1) bombs on covered tiles explode, (2) players on covered tiles
 * die (holders light at the hand), (3) unburnt cord nodes on covered tiles ignite.
 */
export function applyBlasts(s: GameState, invulnerable: boolean, ctx: TickCtx): void {
  if (!s.blasts.length) return;
  for (const blast of s.blasts.slice()) {
    for (const t of blast.tiles) {
      const b = bombAt(s, t);
      if (b) explode(s, b, { kind: 'chain', byExplosion: blast.explosionId }, ctx);
    }
  }
  if (!invulnerable) {
    for (const p of s.players) {
      if (!p || !p.alive) continue;
      const t = playerTile(p);
      const blast = s.blasts.find((b) => b.tiles.includes(t));
      if (blast) kill(s, p, blast.explosionId);
    }
  }
  for (const blast of s.blasts) {
    const owner = s.explosions.find((e) => e.id === blast.explosionId)?.owner ?? null;
    for (const t of blast.tiles) {
      for (const cord of s.cords) {
        for (let k = 0; k < cord.nodes.length; k++) {
          const node = cord.nodes[k]!;
          if (node.burnt || node.tile !== t) continue;
          igniteNode(s, cord, k, { kind: 'blast', by: owner, tile: t, tick: s.tick, explosionId: blast.explosionId });
        }
      }
    }
  }
}
