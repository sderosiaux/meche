// Hand-built GameState snapshots for visual checks of the renderer without the simulation
// (?fixture=knot | burning | blast). Test data only: nothing here is game logic, and the
// `animate` functions only move things along so ash, sparks and fades can be seen.
import { BLAST_TICKS, CORD_WARN, GRID_H, GRID_W, SUB, START_BOMBS, START_CORD_MAX, START_RANGE, WALK_SPEED } from '../sim/constants';
import type { Bomb, Cell, Cord, Explosion, FireFront, GameState, Ignition, Player, PlayerId, SimEvent, Tile } from '../sim/types';

const t = (x: number, y: number): Tile => y * GRID_W + x;

function cells(crates: readonly [number, number][]): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1) out.push('frame');
      else if (x % 2 === 0 && y % 2 === 0) out.push('pillar');
      else out.push('floor');
    }
  }
  for (const [x, y] of crates) out[t(x, y)] = 'crate';
  return out;
}

function player(id: PlayerId, x: number, y: number, extra: Partial<Player> = {}): Player {
  return {
    id,
    alive: true,
    x: x * SUB + SUB / 2,
    y: y * SUB + SUB / 2,
    facing: 'down',
    moving: false,
    bombsMax: START_BOMBS,
    range: START_RANGE,
    cordMax: START_CORD_MAX,
    speed: WALK_SPEED,
    heldCord: null,
    heldSince: null,
    diedAt: null,
    ...extra,
  };
}

function cord(id: number, owner: PlayerId, bombId: number, path: readonly [number, number][], held: boolean, burntFrom?: number): Cord {
  return {
    id,
    owner,
    bombId,
    held,
    nodes: path.map(([x, y], i) => ({ tile: t(x, y), burnt: burntFrom !== undefined && i >= burntFrom })),
  };
}

function bomb(id: number, owner: PlayerId, x: number, y: number, cordId: number, fuse: number | null = null): Bomb {
  return { id, owner, tile: t(x, y), cordId, fuse, walkableBy: [], placedAt: -100 };
}

function base(players: (Player | null)[], crates: readonly [number, number][], tick = 600): GameState {
  return {
    config: { seed: 1, players: players.filter((p): p is Player => p !== null).map((p) => p.id) },
    tick,
    phase: 'playing',
    phaseTick: tick - 180,
    freeze: 0,
    rng: 1,
    nextId: 100,
    cells: cells(crates),
    players,
    bombs: [],
    cords: [],
    fronts: [],
    blasts: [],
    explosions: [],
    deaths: [],
    winner: null,
    events: [],
  };
}

const CRATES: [number, number][] = [
  [3, 7], [4, 7], [9, 1], [10, 1], [1, 5], [1, 6], [13, 5], [13, 6], [9, 11], [3, 9], [11, 3], [12, 3],
];

export interface Fixture {
  readonly state: GameState;
  /** Optional time-driven variant (seconds since start) for things that only show while moving. */
  readonly animate?: (seconds: number, previous: GameState) => GameState;
  /** Events re-emitted every `loopSeconds` so one-shot visuals (death chain) can be inspected. */
  readonly loopEvents?: readonly SimEvent[];
  readonly loopSeconds?: number;
}

/** (a) Two held cords crossing on (5,3): knot bead; red idles (hint ring), blue is near max length (flashing hand). */
function knot(): Fixture {
  const red: [number, number][] = [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [6, 5], [7, 5]];
  const blue: [number, number][] = [[7, 3], [6, 3], [5, 3], [5, 2], [5, 1], [4, 1]];
  const s = base(
    [
      player(0, 7, 5, { heldCord: 1, heldSince: 300, facing: 'right' }),
      player(1, 4, 1, { heldCord: 2, heldSince: 590, facing: 'left', cordMax: blue.length - 1 + CORD_WARN - 1 }),
      player(2, 1, 11),
      player(3, 13, 11),
    ],
    CRATES,
  );
  s.bombs = [bomb(10, 0, 3, 3, 1), bomb(11, 1, 7, 3, 2)];
  s.cords = [cord(1, 0, 10, red, true), cord(2, 1, 11, blue, true)];
  return { state: s };
}

/** (b) Yellow cord lit at the hand on (13,9), flame running back to the bomb on (9,7), leaving ash. */
function burning(): Fixture {
  const path: [number, number][] = [[9, 7], [10, 7], [11, 7], [11, 8], [11, 9], [12, 9], [13, 9]];
  const ign: Ignition = { kind: 'hand', by: 2, tile: t(13, 9), tick: 500, explosionId: null };
  const s = base([player(0, 1, 1), player(1, 13, 1), player(2, 13, 11, { facing: 'down' }), player(3, 1, 11)], CRATES);
  s.bombs = [bomb(20, 2, 9, 7, 5)];
  s.cords = [cord(5, 2, 20, path, false, 6)];
  const last = path.length - 1;
  const animate = (seconds: number, previous: GameState): GameState => {
    const cycle = last + 1.6; // tiles of travel, then a short wobble on the bomb
    const pos = (seconds * 2.5) % cycle;
    const next: GameState = structuredClone(previous);
    next.tick = previous.tick + 1;
    const c = next.cords[0]!;
    const b = next.bombs[0]!;
    if (pos >= last) {
      c.nodes.forEach((n) => (n.burnt = true));
      next.fronts = [];
      b.fuse = Math.max(0, Math.round(36 - ((pos - last) / 1.6) * 36));
      return next;
    }
    b.fuse = null;
    const from = last - Math.floor(pos);
    const progress = Math.round((pos - Math.floor(pos)) * SUB);
    c.nodes.forEach((n, i) => (n.burnt = i >= from));
    const front: FireFront = { id: 900, cordId: 5, from, to: from - 1, progress, ignition: ign, trail: path.slice(from).map(([x, y]) => t(x, y)).reverse() };
    next.fronts = [front];
    return next;
  };
  return { state: animate(0, s), animate };
}

/**
 * (c) Green's blast on (11,9) lit blue's cord at (11,7); the fire ran to blue's bomb on (7,5),
 * whose cross killed red on (5,5). The death chain must show both crosses, the trail and a green star.
 */
function blast(): Fixture {
  const blueCord: [number, number][] = [[7, 5], [7, 6], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7]];
  const s = base(
    [player(0, 5, 5, { alive: false, diedAt: 590 }), player(1, 3, 1, { facing: 'right' }), player(2, 1, 11), player(3, 13, 9, { facing: 'left' })],
    CRATES,
  );
  const greenIgn: Ignition = { kind: 'hand', by: 3, tile: t(13, 9), tick: 480, explosionId: null };
  const ex1: Explosion = {
    id: 1,
    bombId: 30,
    owner: 3,
    tile: t(11, 9),
    tiles: [t(11, 9), t(10, 9), t(9, 9), t(12, 9), t(13, 9), t(11, 8), t(11, 7), t(11, 10), t(11, 11)],
    tick: 520,
    trigger: { kind: 'fire', ignition: greenIgn, trail: [t(13, 9), t(12, 9), t(11, 9)] },
  };
  const blueIgn: Ignition = { kind: 'blast', by: 3, tile: t(11, 7), tick: 520, explosionId: 1 };
  const ex2: Explosion = {
    id: 2,
    bombId: 31,
    owner: 1,
    tile: t(7, 5),
    tiles: [t(7, 5), t(6, 5), t(5, 5), t(8, 5), t(9, 5), t(7, 4), t(7, 3), t(7, 6), t(7, 7)],
    tick: 590,
    trigger: { kind: 'fire', ignition: blueIgn, trail: [...blueCord].reverse().map(([x, y]) => t(x, y)) },
  };
  s.explosions = [ex1, ex2];
  s.blasts = [{ explosionId: 2, tiles: ex2.tiles, ticksLeft: BLAST_TICKS }];
  s.deaths = [{ player: 0, tick: 590, explosionId: 2 }];
  s.cords = [cord(7, 1, 31, blueCord, false, 0)];
  const events: SimEvent[] = [
    { t: 'explosion', explosionId: 2 },
    { t: 'player-died', player: 0, explosionId: 2 },
  ];
  const animate = (seconds: number, previous: GameState): GameState => {
    const next: GameState = structuredClone(previous);
    next.tick = previous.tick + 1;
    const k = (seconds % 2.5) / 0.5; // blast fades over 0.5 s, then the scene rests
    next.blasts = k < 1 ? [{ explosionId: 2, tiles: ex2.tiles, ticksLeft: Math.round(BLAST_TICKS * (1 - k)) }] : [];
    return next;
  };
  return { state: s, animate, loopEvents: events, loopSeconds: 2.5 };
}

export function loadFixture(name: string): Fixture | null {
  switch (name) {
    case 'knot':
      return knot();
    case 'burning':
      return burning();
    case 'blast':
      return blast();
    default:
      return null;
  }
}

export const FIXTURES = ['knot', 'burning', 'blast'] as const;
