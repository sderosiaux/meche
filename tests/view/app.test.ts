import { describe, expect, it } from 'vitest';
import { afterInterlude, matchSeed, newMatch, recordRound, roundSeed } from '../../src/app/match';
import { humanInputFor, simReadsInput } from '../../src/app/tickGate';
import { ActionLatch } from '../../src/input/controls';
import { createRound, step } from '../../src/sim';
import { COUNTDOWN_TICKS } from '../../src/sim/constants';
import type { GameState, PlayerInput, TickInputs } from '../../src/sim/types';

const idle: TickInputs = [];

function toPlaying(seed: number): GameState {
  let s = createRound({ seed, players: [0, 1] });
  for (let i = 0; i < COUNTDOWN_TICKS; i++) s = step(s, idle);
  expect(s.phase).toBe('playing');
  return s;
}

describe('human input gate', () => {
  it('keeps a tap latched through the countdown and a death freeze, then delivers it once', () => {
    const latch = new ActionLatch();
    const sample = (): PlayerInput => ({ dir: null, action: latch.consume() });
    latch.press();

    const countdown = createRound({ seed: 5, players: [0, 1] });
    expect(simReadsInput(countdown)).toBe(false);
    expect(humanInputFor(countdown, sample)).toBeUndefined();

    const playing = toPlaying(5);
    const frozen: GameState = { ...playing, freeze: 10 };
    expect(humanInputFor(frozen, sample)).toBeUndefined();

    expect(humanInputFor(playing, sample)).toEqual({ dir: null, action: true });
    expect(humanInputFor(playing, sample)).toEqual({ dir: null, action: false });
  });

  it('ignores input once the round is over', () => {
    expect(simReadsInput({ ...toPlaying(6), phase: 'over' })).toBe(false);
  });
});

describe('match seeds', () => {
  it('keeps the URL seed for the first match and derives fresh ones for rematches', () => {
    expect(matchSeed(1234, 0)).toBe(1234);
    const rematches = [1, 2, 3].map((i) => matchSeed(1234, i));
    expect(new Set([1234, ...rematches]).size).toBe(4);
    expect(matchSeed(1234, 2)).toBe(rematches[1]);
  });
});

describe('round → interlude → match over', () => {
  /** P0 drops a bomb, steps one tile right, lights it at once and waits: its own cross kills it. */
  function playSelfKill(seed: number): GameState {
    let s = toPlaying(seed);
    const script: PlayerInput[] = [
      { dir: null, action: true },
      ...Array.from({ length: 15 }, (): PlayerInput => ({ dir: 'right', action: false })),
      { dir: null, action: true },
    ];
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 2000) {
      const p0 = humanInputFor(s, () => script.shift() ?? { dir: null, action: false });
      s = step(s, [p0, undefined]);
    }
    return s;
  }

  it('scores each finished round and ends the match at three wins', () => {
    let match = newMatch({ seed: 22, bots: 1, level: 'moyen' });
    for (let r = 0; r < 3; r++) {
      const end = playSelfKill(roundSeed(match.setup.seed, match.round));
      expect(end.phase).toBe('over');
      expect(end.winner).toBe(1);
      match = recordRound(match, end.winner);
      expect(afterInterlude(match)).toBe(r < 2 ? 'next-round' : 'match-over');
    }
    expect(match.champion).toBe(1);
    expect(match.wins).toEqual([0, 3, 0, 0]);
  });
});
