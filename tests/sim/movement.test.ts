import { describe, expect, it } from 'vitest';
import { centerOf, tileOf } from '../../src/sim';
import { at, hold, p, playing, press, teleport, walk } from './helpers';

describe('bomb tile', () => {
  it('the placer may walk off its bomb and come back toward the center while still on it', () => {
    const run = playing();
    teleport(run, 0, 2, 1);
    press(run, 0);
    hold(run, 0, 'left', 5); // still on (2,1)
    expect(run.s.bombs[0]!.walkableBy).toEqual([0]);
    hold(run, 0, 'right', 10);
    expect(p(run, 0).x).toBeGreaterThan(centerOf(2));
  });

  it('once off it, only the holder of its cord may step back on a bomb tile', () => {
    const run = playing();
    teleport(run, 0, 2, 1);
    press(run, 0);
    hold(run, 0, 'left', 8); // center crosses into (1,1)
    expect(run.s.bombs[0]!.walkableBy).toEqual([]);
    hold(run, 0, 'right', 8); // still holding the cord: back on (2,1), the cord is reeled in
    expect(tileOf(p(run, 0).x, p(run, 0).y)).toBe(at(2, 1));
    expect(run.s.cords[0]!.nodes).toHaveLength(1);
  });

  it('nobody else re-enters a bomb tile, nor the placer once the cord is released', () => {
    const run = playing();
    teleport(run, 0, 2, 1);
    press(run, 0);
    walk(run, 0, [[1, 1]]); // P0 holds the cord, bomb unlit
    teleport(run, 1, 3, 3);
    walk(run, 1, [[3, 1]]);
    const x1 = p(run, 1).x;
    hold(run, 1, 'left', 20);
    expect(p(run, 1).x).toBe(x1);
    press(run, 0); // lights and lets go: 60 ticks before the blast
    const x = p(run, 0).x;
    hold(run, 0, 'right', 20);
    expect(p(run, 0).x).toBe(x);
    expect(run.s.explosions).toHaveLength(0);
  });

  it('everyone on the tile at placement may leave it', () => {
    const run = playing();
    teleport(run, 1, 1, 1);
    press(run, 0);
    expect(run.s.bombs[0]!.walkableBy).toEqual([0, 1]);
    walk(run, 1, [[1, 2]]);
    expect(run.s.bombs[0]!.walkableBy).toEqual([0]);
  });

  it('other players are blocked by a bomb', () => {
    const run = playing();
    teleport(run, 0, 3, 1);
    press(run, 0);
    walk(run, 0, [[4, 1]]);
    teleport(run, 1, 1, 1);
    hold(run, 1, 'right', 40);
    expect(p(run, 1).x).toBe(centerOf(2));
  });
});

describe('cornering assist', () => {
  it('slides back to the lane then turns when within 40 % of a tile', () => {
    const run = playing();
    teleport(run, 0, 3, 1);
    hold(run, 0, 'down', 5); // 320 sub-units below the lane
    expect(p(run, 0).y).toBe(centerOf(1) + 320);
    hold(run, 0, 'right', 5);
    expect(p(run, 0).y).toBe(centerOf(1));
    expect(p(run, 0).x).toBe(centerOf(3));
    hold(run, 0, 'right', 1);
    expect(p(run, 0).x).toBe(centerOf(3) + 64);
  });

  it('does nothing when farther than 40 % off the lane', () => {
    const run = playing();
    teleport(run, 0, 3, 1);
    hold(run, 0, 'down', 7); // 448 off
    const { x, y } = p(run, 0);
    hold(run, 0, 'right', 5);
    expect([p(run, 0).x, p(run, 0).y]).toEqual([x, y]);
  });

  it('does nothing when the turn is blocked', () => {
    const run = playing();
    teleport(run, 0, 3, 1);
    hold(run, 0, 'down', 12); // inside (3,2), 192 above its center; (4,2) is a pillar
    const { x, y } = p(run, 0);
    hold(run, 0, 'right', 5);
    expect([p(run, 0).x, p(run, 0).y]).toEqual([x, y]);
  });

  it('a wall clamps the player at its tile center', () => {
    const run = playing();
    hold(run, 0, 'up', 10);
    expect(p(run, 0).y).toBe(centerOf(1));
    hold(run, 0, 'right', 4);
    expect(p(run, 0).x).toBe(centerOf(1) + 256);
    expect(at(1, 1)).toBe(16);
  });
});
