import { describe, expect, it } from 'vitest';
import { forecast, step } from '../../src/sim';
import { p, playing, press, teleport, walk } from './helpers';

describe('performance sanity', () => {
  it('step and forecast stay cheap mid-game with 4 players and several cords', () => {
    const run = playing([0, 1, 2, 3]);
    for (const id of [0, 1, 2, 3] as const) p(run, id).bombsMax = 3;
    teleport(run, 0, 1, 1);
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1]]);
    teleport(run, 1, 13, 1);
    press(run, 1);
    walk(run, 1, [[12, 1], [11, 1], [11, 2], [11, 3]]);
    press(run, 1);
    teleport(run, 2, 1, 11);
    press(run, 2);
    walk(run, 2, [[1, 10], [1, 9], [2, 9], [3, 9], [3, 8]]);
    teleport(run, 3, 13, 11);
    press(run, 3);
    walk(run, 3, [[12, 11], [11, 11], [11, 10], [11, 9], [10, 9]]);
    press(run, 3);
    expect(run.s.fronts.length).toBeGreaterThan(0);

    let s = run.s;
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) s = step(s, [{ dir: 'down', action: false }, undefined, { dir: 'right', action: false }, undefined]);
    const stepMs = (performance.now() - t0) / n;

    const fTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      forecast(run.s);
      fTimes.push(performance.now() - t);
    }
    fTimes.sort((a, b) => a - b);
    const forecastMs = fTimes[10]!;
    console.log(`step avg ${stepMs.toFixed(3)} ms, forecast(360) median ${forecastMs.toFixed(2)} ms`);
    expect(stepMs).toBeLessThan(1);
    expect(forecastMs).toBeLessThan(15);
  });
});
