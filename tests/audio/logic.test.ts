import { describe, expect, it } from 'vitest';
import { sizzleRate } from '../../src/audio/eta';
import { alignedOffset, boomId, countdownCue, countdownMark, musicLevel, musicScene, nextVariant, panForTile } from '../../src/audio/logic';
import { createRound } from '../../src/sim';
import { COUNTDOWN_TICKS, GRID_W } from '../../src/sim/constants';
import type { GameState } from '../../src/sim/types';

function round(players: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3]): GameState {
  return createRound({ seed: 7, players });
}

function playing(s: GameState): GameState {
  return { ...s, phase: 'playing', phaseTick: 0 };
}

function kill(s: GameState, ...ids: number[]): GameState {
  return { ...s, players: s.players.map((p) => (p && ids.includes(p.id) ? { ...p, alive: false } : p)) };
}

describe('music scene', () => {
  it('plays the menu before any round and the match track during one', () => {
    expect(musicScene(null)).toBe('menu');
    expect(musicScene(round())).toBe('match');
    expect(musicScene(playing(round()))).toBe('match');
  });

  it('switches to tension when two players remain out of a bigger field', () => {
    expect(musicScene(kill(playing(round()), 1))).toBe('match');
    expect(musicScene(kill(playing(round()), 1, 2))).toBe('tension');
  });

  it('a 1v1 round never counts as tension', () => {
    expect(musicScene(playing(round([0, 1])))).toBe('match');
  });

  it('music steps back outside a running round, except in the menu', () => {
    expect(musicLevel(null, false)).toBe(1);
    expect(musicLevel(round(), true)).toBe(1);
    expect(musicLevel(round(), false)).toBeLessThan(1);
  });
});

describe('countdown cues', () => {
  it('ticks on each countdown second once, then rings at the start of play', () => {
    let s = round();
    let mark = null;
    const cues: string[] = [];
    // Frames of 2 ticks, as at a high frame rate with skipped ticks.
    for (let t = 0; t <= COUNTDOWN_TICKS + 4; t += 2) {
      // structuredClone like step(): object identity changes every tick, the round must still be recognised.
      s = structuredClone(t < COUNTDOWN_TICKS ? { ...s, tick: t, phase: 'countdown', phaseTick: t } : { ...s, tick: t, phase: 'playing', phaseTick: t - COUNTDOWN_TICKS });
      const cur = countdownMark(s);
      const cue = countdownCue(mark, cur);
      if (cue) cues.push(`${cue}@${t}`);
      mark = cur;
    }
    expect(cues).toEqual(['tick@0', 'tick@60', 'tick@120', 'go@180']);
  });

  it('a new round restarts the countdown even if the previous one ended mid-count', () => {
    const a = round();
    const b = createRound({ seed: 8, players: [0, 1] });
    const midA = countdownMark({ ...a, tick: 130, phase: 'countdown', phaseTick: 130 });
    expect(countdownCue(midA, countdownMark({ ...b, tick: 0, phase: 'countdown', phaseTick: 0 }))).toBe('tick');
    // Same seed again (restart): the tick going back marks a new round too.
    expect(countdownCue(midA, countdownMark({ ...a, tick: 1, phase: 'countdown', phaseTick: 1 }))).toBe('tick');
  });

  it('never rings without having seen the countdown of that round', () => {
    expect(countdownCue(null, countdownMark(playing(round())))).toBeNull();
  });
});

describe('helpers', () => {
  it('sizzle speeds up as the bomb gets closer', () => {
    expect(sizzleRate(36)).toBeGreaterThan(sizzleRate(120));
    expect(sizzleRate(120)).toBeGreaterThan(sizzleRate(400));
    expect(sizzleRate(400)).toBeCloseTo(sizzleRate(240));
  });

  it('pans by column, clamped', () => {
    expect(panForTile(7)).toBeCloseTo(0);
    expect(panForTile(GRID_W + 1)).toBeLessThan(0);
    expect(panForTile(GRID_W + 13)).toBeGreaterThan(0);
    expect(Math.abs(panForTile(GRID_W * 2 + 14))).toBeLessThanOrEqual(0.8);
  });

  it('a range-3 cross on open floor is a big explosion', () => {
    expect(boomId(5)).toBe('boom-small');
    expect(boomId(13)).toBe('boom-big');
  });

  it('round-robins variants per id', () => {
    const c = new Map<string, number>();
    expect([0, 1, 2, 3].map(() => nextVariant(c, 'step', 3))).toEqual([0, 1, 2, 0]);
    expect(nextVariant(c, 'place', 2)).toBe(0);
  });

  it('keeps the beat when swapping two loops of the same length', () => {
    // Started at t=10 with offset 0.1 (loop start); 5 s later the loop is 5 s in.
    expect(alignedOffset(15, 10, 0.1, 51.43)).toBeCloseTo(5.1);
    expect(alignedOffset(10 + 51.43 + 1, 10, 0.1, 51.43)).toBeCloseTo(1.1);
  });
});
