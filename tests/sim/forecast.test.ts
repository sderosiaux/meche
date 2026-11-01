import { describe, expect, it } from 'vitest';
import { forecast } from '../../src/sim';
import { BLAST_TICKS, BOMB_TILE_TICKS } from '../../src/sim/constants';
import { at, events, idle, playing, press, teleport, walk } from './helpers';

describe('forecast', () => {
  it('predicts the idle future of a lit cord exactly', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [3, 2], [3, 3]]);
    press(run, 0);
    const origin = run.s.tick;
    const f = forecast(run.s);
    expect(f.explosions.map((x) => x.at)).toEqual([4 * 24 + BOMB_TILE_TICKS]);
    expect(f.blastAt[at(2, 1)]).toBe(4 * 24 + BOMB_TILE_TICKS);
    expect(f.blastUntil[at(2, 1)]).toBe(4 * 24 + BOMB_TILE_TICKS + BLAST_TICKS - 1);
    expect(f.blastAt[at(3, 3)]).toBe(-1);
    idle(run, 200);
    expect(events(run, 'explosion').map((e) => e.tick - origin)).toEqual(f.explosions.map((x) => x.at));
    expect(run.s.deaths).toHaveLength(0);
  });

  it('predicts a hijack through crossing cords, and leaves the state untouched', () => {
    const run = playing();
    teleport(run, 1, 7, 1);
    press(run, 1);
    walk(run, 1, [[7, 2], [7, 3], [7, 4], [7, 5]]);
    teleport(run, 0, 3, 3);
    run.s.players[0]!.cordMax = 10;
    press(run, 0);
    walk(run, 0, [[4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3]]);
    press(run, 0);
    const origin = run.s.tick;
    const before = structuredClone(run.s);
    const f = forecast(run.s);
    expect(run.s).toEqual(before);
    expect(f.explosions).toHaveLength(2);
    idle(run, 300);
    expect(events(run, 'explosion').map((e) => e.tick - origin)).toEqual(f.explosions.map((x) => x.at));
  });

  it('ignores held cords and players: nothing burning means an empty forecast', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1]]);
    const f = forecast(run.s);
    expect(f.explosions).toHaveLength(0);
    expect([...f.blastAt].every((v) => v === -1)).toBe(true);
  });

  it('marks blasts already active at offset 0', () => {
    const run = playing();
    teleport(run, 1, 9, 9);
    press(run, 0);
    press(run, 0);
    idle(run, BOMB_TILE_TICKS);
    const f = forecast(run.s);
    expect(f.blastAt[at(1, 1)]).toBe(0);
    expect(f.blastUntil[at(1, 1)]).toBe(BLAST_TICKS - 1);
  });
});
