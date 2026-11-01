// Bots press the same buttons as a human: one direction and the Action edge per tick.
//
// Priorities, every tick: survive (leave any tile a known blast will reach), then, while holding a
// cord, get out of the bomb's cross and decide when to light; when free, walk to the best tile to
// place a bomb on (crates, enemies, traps) as long as an escape exists, otherwise roam.
import { tileOf } from '../sim';
import { BOMB_TILE_TICKS, FIRE_SPEED, SUB } from '../sim/constants';
import { nextU32, seedRng } from '../sim/rng';
import type { Bomb, Cord, GameState, Player, PlayerId, PlayerInput, Tile } from '../sim/types';
import type { Bot, BotLevel, CreateBot } from './api';
import { findPath, reachSteps, safeFrom, type PlanCtx } from './path';
import { Perception } from './perception';
import { recenter, steer } from './steer';
import { N_TILES, NEIGHBOURS, blockedFor, bombOn, crossOf, manhattan } from './world';

interface Params {
  /** Gameplay ticks before a threat caused by someone else is noticed. */
  readonly delay: number;
  readonly margin: number;
  /** Ticks a cord is held once out of the cross; 0 = light at once. */
  readonly holdMax: number;
  readonly enemyWeight: number;
  /** Only go for enemies once no crate is worth a bomb. */
  readonly cratesFirst: boolean;
  /** Value of a placement that leaves an enemy no tile outside the cross. 0 = not looked for. */
  readonly trapWeight: number;
  readonly hijack: boolean;
  /** Chance (‰) to pause after acting, and pause bounds in ticks. */
  readonly pausePermille: number;
  readonly pauseMin: number;
  readonly pauseMax: number;
  /** Chance (‰) to roam instead of chasing the best target. */
  readonly roamPermille: number;
  /** Stay out of crosses of bombs held by enemies. */
  readonly avoidHeld: boolean;
}

const PARAMS: Readonly<Record<BotLevel, Params>> = {
  facile: {
    delay: 18,
    margin: 6,
    holdMax: 0,
    enemyWeight: 1,
    cratesFirst: true,
    trapWeight: 0,
    hijack: false,
    pausePermille: 450,
    pauseMin: 15,
    pauseMax: 60,
    roamPermille: 200,
    avoidHeld: false,
  },
  moyen: {
    delay: 9,
    margin: 4,
    holdMax: 150,
    enemyWeight: 3,
    cratesFirst: false,
    trapWeight: 10,
    hijack: true,
    pausePermille: 80,
    pauseMin: 5,
    pauseMax: 20,
    roamPermille: 0,
    avoidHeld: true,
  },
};

const IDLE: PlayerInput = { dir: null, action: false };
const TICKS_PER_CORD_TILE = SUB / FIRE_SPEED;
/** A held enemy bomb that could blow sooner than this is worth staying away from. */
const HELD_THREAT_TICKS = 150;

class BrainBot implements Bot {
  private readonly p: Params;
  private readonly perc: Perception;
  private readonly rng: { rng: number };
  private target: Tile | null = null;
  private targetUntil = 0;
  private lightFast = false;
  private escapedAt: number | null = null;
  private pauseUntil = 0;
  private roamGoal: Tile | null = null;
  private roamUntil = 0;

  constructor(
    readonly id: PlayerId,
    readonly level: BotLevel,
    seed: number,
  ) {
    this.p = PARAMS[level];
    this.perc = new Perception(id, this.p.delay);
    this.rng = { rng: seedRng(seed ^ (id * 0x51ed27)) };
  }

  decide(s: GameState): PlayerInput {
    this.perc.observe(s);
    const me = s.players[this.id];
    if (!me || !me.alive || (s.phase !== 'playing' && s.phase !== 'resolving')) return IDLE;
    const here = tileOf(me.x, me.y);
    const ctx: PlanCtx = {
      blocked: blockedFor(s, me, here),
      danger: this.perc.danger(s),
      g: this.perc.g,
      tpt: Math.ceil(SUB / me.speed),
      margin: this.p.margin,
    };
    return me.heldCord !== null ? this.holding(s, me, here, ctx) : this.free(s, me, here, ctx);
  }

  // ── holding a cord ────────────────────────────────────────────────────────

  private holding(s: GameState, me: Player, here: Tile, ctx: PlanCtx): PlayerInput {
    const cord = s.cords.find((c) => c.id === me.heldCord);
    const bomb = cord && s.bombs.find((b) => b.id === cord.bombId);
    if (!cord || !bomb) return this.survive(me, here, ctx) ?? this.stay(me, here);
    const cross = crossOf(s, bomb.tile, me.range);

    if (cross.has(here)) {
      this.escapedAt = null;
      const path = findPath(ctx, here, (t) => !cross.has(t), { maxSteps: 12 });
      return path && path.length ? this.go(me, here, path) : this.stay(me, here); // nothing is lit yet: waiting is safe
    }

    if (this.escapedAt === null) this.escapedAt = ctx.g;
    const unsafe = !safeFrom(ctx, here, ctx.g);
    const flee = unsafe ? findPath(ctx, here, () => true) : null;
    const fleeDir = flee && flee.length ? steer(me, here, flee[0]!) : null;
    if (this.p.holdMax === 0 || this.lightFast || unsafe) return this.light(fleeDir);

    const enemyClose = this.enemies(s).some((e) => cross.has(e.tile) || manhattan(e.tile, bomb.tile) <= 2);
    const timedOut = ctx.g - this.escapedAt >= this.p.holdMax;
    const aboutToBeHijacked = cord.nodes.some((n) => {
      const from = ctx.danger.from[n.tile]!;
      return !n.burnt && from >= 0 && from <= ctx.g + 60;
    });
    if (enemyClose || timedOut || aboutToBeHijacked) return this.light(null);

    if (this.p.hijack) {
      const hop = this.crossEnemyCord(s, me, here, ctx, cross);
      if (hop) return hop;
    }
    return this.stay(me, here);
  }

  private light(dir: PlayerInput['dir']): PlayerInput {
    this.lightFast = false;
    this.escapedAt = null;
    this.maybePause();
    return { dir, action: true };
  }

  /**
   * Hijack by contact: an enemy still inside its own bomb's cross holds a cord; walk onto one of
   * its tiles (our cord follows) and light there, so the fire jumps to theirs.
   */
  private crossEnemyCord(s: GameState, me: Player, here: Tile, ctx: PlanCtx, myCross: Set<Tile>): PlayerInput | null {
    const targets = new Set<Tile>();
    for (const { player, cord, bomb } of this.enemyHeld(s)) {
      const theirCross = crossOf(s, bomb.tile, player.range);
      if (!theirCross.has(tileOf(player.x, player.y))) continue;
      for (let i = 1; i < cord.nodes.length; i++) {
        const n = cord.nodes[i]!;
        if (!n.burnt && !myCross.has(n.tile)) targets.add(n.tile);
      }
    }
    if (!targets.size) return null;
    const path = findPath(ctx, here, (t) => targets.has(t), { maxSteps: 3 });
    if (!path) return null;
    if (!path.length) return this.light(null);
    return this.go(me, here, path);
  }

  // ── free hands ────────────────────────────────────────────────────────────

  private free(s: GameState, me: Player, here: Tile, ctx: PlanCtx): PlayerInput {
    const flee = this.survive(me, here, ctx);
    if (flee) {
      this.target = null;
      return flee;
    }
    if (ctx.g < this.pauseUntil) return this.stay(me, here);

    const owned = s.bombs.filter((b) => b.owner === me.id).length;
    if (owned < me.bombsMax) {
      if (this.target === null || ctx.g >= this.targetUntil) {
        if (this.chance(this.p.roamPermille)) {
          this.target = null;
          this.targetUntil = ctx.g + 45;
        } else {
          this.pickTarget(s, me, here, ctx);
        }
      }
      if (this.target !== null) {
        if (this.target === here) {
          this.target = null;
          if (this.canEscape(s, me, here, ctx, 0)) return { dir: null, action: true };
          this.lightFast = false;
        } else {
          const goal = this.target;
          const path = findPath(ctx, here, (t) => t === goal, { maxSteps: 20 });
          if (path && path.length) return this.go(me, here, path);
          this.target = null;
        }
      }
    }
    return this.roam(s, me, here, ctx);
  }

  /** Step off a tile that a known blast will reach; null when the current tile is fine. */
  private survive(me: Player, here: Tile, ctx: PlanCtx): PlayerInput | null {
    if (safeFrom(ctx, here, ctx.g)) return null;
    const path = findPath(ctx, here, () => true);
    if (!path || !path.length) return this.stay(me, here);
    return this.go(me, here, path);
  }

  private pickTarget(s: GameState, me: Player, here: Tile, ctx: PlanCtx): void {
    this.target = null;
    this.lightFast = false;
    const steps = reachSteps(ctx, here, 16);
    const enemies = this.enemies(s);
    const avoid = this.p.avoidHeld ? this.heldThreats(s) : null;
    const held = this.p.hijack ? this.enemyHeld(s) : [];
    let cand: { t: Tile; k: number; score: number; fast: boolean; crates: number }[] = [];
    for (let t = 0; t < N_TILES; t++) {
      const k = steps[t]!;
      if (k < 0 || !safeFrom(ctx, t, ctx.g + k * ctx.tpt)) continue;
      if (avoid?.has(t)) continue;
      if (t !== here && bombOn(s, t)) continue;
      const cross = crossOf(s, t, me.range);
      let crates = 0;
      for (const c of cross) if (s.cells[c] === 'crate') crates++;
      let hits = 0;
      for (const e of enemies) if (cross.has(e.tile)) hits++;
      let value = crates + this.p.enemyWeight * hits;
      let fast = false;
      if (this.p.trapWeight && enemies.some((e) => manhattan(e.tile, t) <= me.range + 3)) {
        const trapped = this.trappedBy(s, t, cross, ctx, enemies);
        if (trapped) {
          value += this.p.trapWeight * trapped;
          fast = true;
        }
      }
      for (const h of held) {
        // Lighting this enemy cord would blow a bomb next to someone other than us.
        if (!h.cord.nodes.some((n, i) => i > 0 && !n.burnt && cross.has(n.tile))) continue;
        const theirCross = crossOf(s, h.bomb.tile, h.player.range);
        if (enemies.some((e) => theirCross.has(e.tile))) {
          value += 5;
          fast = true;
        }
      }
      if (value <= 0) continue;
      cand.push({ t, k, score: Math.floor((value * 1000) / (k + 2)), fast, crates });
    }
    if (this.p.cratesFirst && cand.some((c) => c.crates > 0)) cand = cand.filter((c) => c.crates > 0);
    cand.sort((a, b) => b.score - a.score || a.t - b.t);
    for (const c of cand.slice(0, 6)) {
      if (!this.canEscape(s, me, c.t, ctx, c.k)) continue;
      this.target = c.t;
      this.targetUntil = ctx.g + c.k * ctx.tpt + 45;
      this.lightFast = c.fast;
      return;
    }
    this.targetUntil = ctx.g + 20;
  }

  /** After placing on `t` (reached after `k` steps), is there a safe tile outside the cross? */
  private canEscape(s: GameState, me: Player, t: Tile, ctx: PlanCtx, k: number): boolean {
    const cross = crossOf(s, t, me.range);
    const blocked = ctx.blocked.slice();
    blocked[t] = 0; // we stand on it; the BFS never needs to come back
    const avoid = this.p.avoidHeld ? this.heldThreats(s) : null;
    const path = findPath({ ...ctx, blocked }, t, (x) => !cross.has(x) && !avoid?.has(x), {
      startStep: k,
      maxSteps: 10,
    });
    return path !== null && path.length > 0 && path.length <= me.cordMax + 4;
  }

  /** Enemies near `t` with no reachable tile outside `cross` once a bomb sits on `t`. */
  private trappedBy(s: GameState, t: Tile, cross: Set<Tile>, ctx: PlanCtx, enemies: { tile: Tile }[]): number {
    let trapped = 0;
    for (const e of enemies) {
      if (e.tile === t) continue;
      const seen = new Uint8Array(N_TILES);
      const stack = [e.tile];
      seen[e.tile] = 1;
      let free = false;
      while (stack.length && !free) {
        const x = stack.pop()!;
        if (!cross.has(x) && safeFrom(ctx, x, ctx.g)) free = true;
        for (const n of NEIGHBOURS[x]!) {
          if (seen[n] || n === t || ctx.blocked[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (!free) trapped++;
    }
    return trapped;
  }

  private roam(s: GameState, me: Player, here: Tile, ctx: PlanCtx): PlayerInput {
    const avoid = this.p.avoidHeld ? this.heldThreats(s) : null;
    const ok = (t: Tile): boolean => !avoid?.has(t);
    if (this.level === 'moyen') {
      const enemies = this.enemies(s);
      if (!enemies.length) return this.stay(me, here);
      const path = findPath(ctx, here, (t) => ok(t) && enemies.some((e) => manhattan(e.tile, t) <= 3), { maxSteps: 20 });
      return path && path.length ? this.go(me, here, path) : this.stay(me, here);
    }
    if (this.roamGoal === null || this.roamGoal === here || ctx.g >= this.roamUntil) {
      const steps = reachSteps(ctx, here, 10);
      const options: Tile[] = [];
      for (let t = 0; t < N_TILES; t++) if (steps[t]! > 0 && safeFrom(ctx, t, ctx.g + steps[t]! * ctx.tpt)) options.push(t);
      this.roamGoal = options.length ? options[nextU32(this.rng) % options.length]! : null;
      this.roamUntil = ctx.g + 120;
    }
    const goal = this.roamGoal;
    if (goal === null) return this.stay(me, here);
    const path = findPath(ctx, here, (t) => t === goal, { maxSteps: 14 });
    if (!path) {
      this.roamGoal = null;
      return this.stay(me, here);
    }
    return path.length ? this.go(me, here, path) : this.stay(me, here);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private go(me: Player, here: Tile, path: Tile[]): PlayerInput {
    const next = path[0]!;
    return next === here ? this.stay(me, here) : { dir: steer(me, here, next), action: false };
  }

  /** Waiting happens at the tile center (see path.ts occupancy). */
  private stay(me: Player, here: Tile): PlayerInput {
    return { dir: recenter(me, here), action: false };
  }

  private enemies(s: GameState): { id: PlayerId; tile: Tile }[] {
    const out: { id: PlayerId; tile: Tile }[] = [];
    for (const p of s.players) if (p && p.alive && p.id !== this.id) out.push({ id: p.id, tile: tileOf(p.x, p.y) });
    return out;
  }

  private enemyHeld(s: GameState): { player: Player; cord: Cord; bomb: Bomb }[] {
    const out: { player: Player; cord: Cord; bomb: Bomb }[] = [];
    for (const player of s.players) {
      if (!player || !player.alive || player.id === this.id || player.heldCord === null) continue;
      const cord = s.cords.find((c) => c.id === player.heldCord);
      const bomb = cord && s.bombs.find((b) => b.id === cord.bombId);
      if (cord && bomb) out.push({ player, cord, bomb });
    }
    return out;
  }

  /** Tiles an enemy could blow soon by lighting the cord it holds. */
  private heldThreats(s: GameState): Set<Tile> {
    const out = new Set<Tile>();
    for (const { player, cord, bomb } of this.enemyHeld(s)) {
      const eta = (cord.nodes.length - 1) * TICKS_PER_CORD_TILE + BOMB_TILE_TICKS;
      if (eta >= HELD_THREAT_TICKS) continue;
      for (const t of crossOf(s, bomb.tile, player.range)) out.add(t);
    }
    return out;
  }

  private chance(permille: number): boolean {
    return permille > 0 && nextU32(this.rng) % 1000 < permille;
  }

  private maybePause(): void {
    if (!this.chance(this.p.pausePermille)) return;
    const span = this.p.pauseMax - this.p.pauseMin + 1;
    this.pauseUntil = this.perc.g + this.p.pauseMin + (nextU32(this.rng) % span);
  }
}

export const createBot: CreateBot = (id, level, seed) => new BrainBot(id, level, seed);
