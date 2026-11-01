import { START_BOMBS, START_CORD_MAX, START_RANGE, WALK_SPEED } from './constants';
import { SPAWNS, buildArena } from './arena';
import { centerOf } from './grid';
import { seedRng } from './rng';
import type { GameState, Player, PlayerId, RoundConfig } from './types';

function makePlayer(id: PlayerId): Player {
  const [tx, ty] = SPAWNS[id];
  return {
    id,
    alive: true,
    x: centerOf(tx),
    y: centerOf(ty),
    facing: ty === 1 ? 'down' : 'up',
    moving: false,
    bombsMax: START_BOMBS,
    range: START_RANGE,
    cordMax: START_CORD_MAX,
    speed: WALK_SPEED,
    heldCord: null,
    heldSince: null,
    diedAt: null,
  };
}

export function createRound(config: RoundConfig): GameState {
  const holder = { rng: seedRng(config.seed) };
  const cells = buildArena(holder);
  const ids: PlayerId[] = [0, 1, 2, 3];
  return {
    config: { seed: config.seed, players: [...config.players] },
    tick: 0,
    phase: 'countdown',
    phaseTick: 0,
    freeze: 0,
    rng: holder.rng,
    nextId: 1,
    cells,
    players: ids.map((id) => (config.players.includes(id) ? makePlayer(id) : null)),
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
