import { centerOf, createRound, step, tileAt, tileOf } from '../../src/sim';
import { COUNTDOWN_TICKS } from '../../src/sim/constants';
import type { Dir, GameState, Player, PlayerId, PlayerInput, SimEvent } from '../../src/sim/types';

export type Logged = SimEvent & { readonly tick: number };

export interface Run {
  s: GameState;
  readonly log: Logged[];
}

export const at = tileAt;

/** A round already past its countdown; crates removed unless `keepCrates`. */
export function playing(players: PlayerId[] = [0, 1], seed = 1, keepCrates = false): Run {
  let s = createRound({ seed, players });
  for (let i = 0; i < COUNTDOWN_TICKS; i++) s = step(s, []);
  if (s.phase !== 'playing') throw new Error('countdown did not end');
  if (!keepCrates) s.cells = s.cells.map((c) => (c === 'crate' ? 'floor' : c));
  return { s, log: [] };
}

export function p(run: Run, id: PlayerId): Player {
  const pl = run.s.players[id];
  if (!pl) throw new Error(`no player ${id}`);
  return pl;
}

export function tick(run: Run, inputs: Partial<Record<PlayerId, PlayerInput>> = {}): void {
  run.s = step(run.s, [inputs[0], inputs[1], inputs[2], inputs[3]]);
  for (const e of run.s.events) run.log.push({ ...e, tick: run.s.tick });
}

export function idle(run: Run, n: number): void {
  for (let i = 0; i < n; i++) tick(run);
}

/** Press Action for one tick; returns the tick at which it was processed. */
export function press(run: Run, id: PlayerId): number {
  tick(run, { [id]: { dir: null, action: true } });
  return run.s.tick;
}

export function hold(run: Run, id: PlayerId, dir: Dir, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(run, { [id]: { dir, action: false } });
}

export function teleport(run: Run, id: PlayerId, x: number, y: number): void {
  const pl = p(run, id);
  pl.x = centerOf(x);
  pl.y = centerOf(y);
}

/** Walk tile center to tile center along orthogonally adjacent tiles. */
export function walk(run: Run, id: PlayerId, path: ReadonlyArray<readonly [number, number]>): void {
  for (const [tx, ty] of path) {
    const pl = () => p(run, id);
    const cx = centerOf(tx);
    const cy = centerOf(ty);
    let guard = 0;
    while (pl().x !== cx || pl().y !== cy) {
      const dir: Dir = pl().x < cx ? 'right' : pl().x > cx ? 'left' : pl().y < cy ? 'down' : 'up';
      tick(run, { [id]: { dir, action: false } });
      if (++guard > 60) throw new Error(`player ${id} stuck walking to (${tx},${ty}) at tile ${tileOf(pl().x, pl().y)}`);
    }
  }
}

export function events<T extends SimEvent['t']>(run: Run, t: T): Array<Extract<SimEvent, { t: T }> & { tick: number }> {
  return run.log.filter((e) => e.t === t) as Array<Extract<SimEvent, { t: T }> & { tick: number }>;
}

export function runUntil(run: Run, pred: () => boolean, max = 2000): void {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    tick(run);
  }
  throw new Error('condition not reached');
}

export function explosionOf(run: Run, bombId: number) {
  return run.s.explosions.find((x) => x.bombId === bombId);
}
