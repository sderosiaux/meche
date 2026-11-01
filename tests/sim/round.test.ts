import { describe, expect, it } from 'vitest';
import { createRound, step } from '../../src/sim';
import { SPAWNS, safeTiles } from '../../src/sim/arena';
import { COUNTDOWN_TICKS, DEATH_FREEZE_TICKS, GRID_H, GRID_W, RESULT_WINDOW_TICKS, ROUND_TIMEOUT_TICKS } from '../../src/sim/constants';
import { at, events, idle, playing, press, teleport, tick, walk } from './helpers';

describe('arena', () => {
  it('is mirror-symmetric with free spawns for every seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createRound({ seed, players: [0, 1, 2, 3] });
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const c = s.cells[at(x, y)];
          expect(s.cells[at(GRID_W - 1 - x, y)]).toBe(c);
          expect(s.cells[at(x, GRID_H - 1 - y)]).toBe(c);
          const border = x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
          if (border) expect(c).toBe('frame');
          else if (x % 2 === 0 && y % 2 === 0) expect(c).toBe('pillar');
          else expect(['floor', 'crate']).toContain(c);
        }
      }
      for (const t of safeTiles()) expect(s.cells[t]).toBe('floor');
      expect(s.cells.filter((c) => c === 'crate').length).toBeGreaterThan(40);
    }
  });

  it('places only the players of the config, at their spawns', () => {
    const s = createRound({ seed: 3, players: [0, 3] });
    expect(s.players[1]).toBeNull();
    expect(s.players[2]).toBeNull();
    expect(s.players[3]!.x).toBe(SPAWNS[3][0] * 960 + 480);
  });
});

describe('phases', () => {
  it('ignores input during the countdown', () => {
    let s = createRound({ seed: 1, players: [0, 1] });
    for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) s = step(s, [{ dir: 'right', action: true }]);
    expect(s.phase).toBe('countdown');
    expect(s.bombs).toHaveLength(0);
    expect(s.players[0]!.x).toBe(1440);
    s = step(s, []);
    expect(s.phase).toBe('playing');
  });

  it('the survivor wins after the result window', () => {
    const run = playing();
    teleport(run, 1, 9, 9);
    press(run, 0);
    press(run, 0);
    idle(run, 36);
    expect(run.s.phase).toBe('resolving');
    idle(run, DEATH_FREEZE_TICKS + RESULT_WINDOW_TICKS - 1);
    expect(run.s.phase).toBe('resolving');
    tick(run);
    expect(run.s.phase).toBe('over');
    expect(run.s.winner).toBe(1);
    expect(events(run, 'round-over')).toEqual([{ t: 'round-over', winner: 1, tick: run.s.tick }]);
    const frozen = run.s;
    tick(run);
    expect(run.s.phase).toBe('over');
    expect(run.s.events).toEqual([]);
    expect(run.s.tick).toBe(frozen.tick + 1);
  });

  it('is a draw when the last player dies inside the window', () => {
    const run = playing();
    teleport(run, 1, 13, 11);
    press(run, 0);
    press(run, 0); // P0 dies 36 ticks later
    idle(run, 10);
    press(run, 1);
    press(run, 1); // P1 would die 36 ticks later, the freeze pushes it inside the window
    idle(run, 200);
    expect(run.s.deaths.map((d) => d.player)).toEqual([0, 1]);
    expect(run.s.phase).toBe('over');
    expect(run.s.winner).toBeNull();
  });

  it('times out into a draw', () => {
    const run = playing();
    idle(run, ROUND_TIMEOUT_TICKS - 1);
    expect(run.s.phase).toBe('playing');
    tick(run);
    expect(run.s.phase).toBe('over');
    expect(run.s.winner).toBeNull();
  });

  it('a death freezes gameplay for 0.4 s', () => {
    const run = playing();
    teleport(run, 1, 1, 9);
    press(run, 1);
    walk(run, 1, [[2, 9], [3, 9], [4, 9]]);
    press(run, 1); // a front is now running on P1's cord
    press(run, 0);
    const lit = press(run, 0); // P0 dies 36 ticks later
    idle(run, 36);
    expect(run.s.tick - lit).toBe(36);
    expect(run.s.deaths.map((d) => d.player)).toEqual([0]);
    expect(run.s.freeze).toBe(DEATH_FREEZE_TICKS);
    const fronts = JSON.stringify(run.s.fronts);
    expect(run.s.fronts.length).toBeGreaterThan(0);
    const x1 = run.s.players[1]!.x;
    for (let i = 0; i < DEATH_FREEZE_TICKS; i++) tick(run, { 1: { dir: 'right', action: false } });
    expect(JSON.stringify(run.s.fronts)).toBe(fronts);
    expect(run.s.players[1]!.x).toBe(x1);
    expect(run.s.freeze).toBe(0);
    tick(run, { 1: { dir: 'right', action: false } });
    expect(run.s.players[1]!.x).not.toBe(x1); // (4,9) → (5,9) is open
  });
});
